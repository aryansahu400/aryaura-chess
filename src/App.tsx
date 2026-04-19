import React, { useState, useEffect, useCallback } from "react";
import { Chess, Move } from "chess.js";
import { Chessboard } from "react-chessboard";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import { 
  Brain, 
  RotateCcw, 
  ChevronRight, 
  ChevronLeft, 
  Trophy, 
  Info,
  Loader2,
  History,
  Lightbulb,
  FlipVertical2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [game, setGame] = useState(new Chess());
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState<{
    move: string;
    explanation: string;
    evaluation: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boardWidth, setBoardWidth] = useState(560);
  const [cooldown, setCooldown] = useState(0);
  const [boardOrientation, setBoardOrientation] = useState<"white" | "black">("white");

  // Cooldown timer
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const getEvalPercentage = (evalValue: number | undefined) => {
    if (evalValue === undefined) return 50;
    // Scale: +10 is 100%, -10 is 0%
    const percentage = 50 + (evalValue * 5);
    return Math.max(5, Math.min(95, percentage)); // Keep a small sliver visible
  };

  // Responsive board width
  useEffect(() => {
    const handleResize = () => {
      const width = Math.min(window.innerWidth - 40, 560);
      setBoardWidth(width);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function makeAMove(move: any) {
    try {
      const result = game.move(move);
      if (result) {
        setGame(new Chess(game.fen()));
        setMoveHistory(prev => [...prev, result.san]);
        return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  function onDrop({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string }) {
    setSuggestion(null); // Clear suggestion on manual move
    const move = makeAMove({
      from: sourceSquare,
      to: targetSquare,
      promotion: "q", // always promote to queen for simplicity
    });
    return move;
  }

  const getSuggestion = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.post("/api/suggest-move", {
        fen: game.fen(),
      });
      const data = response.data;
      setSuggestion(data);

      // Automatically make the move
      if (data.move) {
        // Lichess returns UCI format (e.g., "e2e4" or "e7e8q")
        let from = data.move.substring(0, 2);
        let to = data.move.substring(2, 4);
        const promotion = data.move.substring(4) || "q";

        // Fix for non-standard castling notation (e.g., e1h1 -> e1g1)
        if (from === "e1" && to === "h1" && game.get("e1")?.type === "k") to = "g1";
        if (from === "e1" && to === "a1" && game.get("e1")?.type === "k") to = "c1";
        if (from === "e8" && to === "h8" && game.get("e8")?.type === "k") to = "g8";
        if (from === "e8" && to === "a8" && game.get("e8")?.type === "k") to = "c8";

        const moveMade = makeAMove({
          from,
          to,
          promotion,
        });

        if (!moveMade) {
          console.error("Failed to make suggested move:", data.move, "mapped to:", { from, to });
          setError(`Engine suggested an invalid move: ${data.move}`);
        }
      }
    } catch (err: any) {
      const errorData = err.response?.data;
      if (err.response?.status === 429) {
        setError(errorData?.details || "Lichess rate limit reached. Please wait a moment.");
        setCooldown(10); // 10 second cooldown on 429
      } else if (err.response?.status === 404) {
        setError(errorData?.details || "This position hasn't been analyzed by Lichess yet.");
      } else {
        setError(errorData?.error || errorData?.details || err.message || "Failed to get suggestion");
      }
    } finally {
      setLoading(false);
      setCooldown(prev => prev === 0 ? 2 : prev); // Small 2s cooldown after every successful/failed request
    }
  };

  const resetGame = () => {
    setGame(new Chess());
    setMoveHistory([]);
    setSuggestion(null);
    setError(null);
  };

  const undoMove = () => {
    game.undo();
    setGame(new Chess(game.fen()));
    setMoveHistory(prev => prev.slice(0, -1));
    setSuggestion(null);
  };

  return (
    <div className="min-h-screen bg-[#161512] text-[#bababa] font-sans selection:bg-[#4a4a4a]">
      {/* Header */}
      <header className="border-b border-[#262421] bg-[#1e1d1a] py-4 px-6 sticky top-0 z-10 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-[#4a4a4a] p-2 rounded-lg">
              <Brain className="w-6 h-6 text-[#81b64c]" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              Aryaura <span className="text-[#81b64c]">Chess</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setBoardOrientation(o => o === "white" ? "black" : "white")}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#262421] hover:bg-[#2d2b28] transition-colors text-sm font-medium border border-[#3c3a37]"
              title="Flip board"
            >
              <FlipVertical2 className="w-4 h-4" />
              {boardOrientation === "white" ? "Play as Black" : "Play as White"}
            </button>
            <button 
              onClick={resetGame}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#262421] hover:bg-[#2d2b28] transition-colors text-sm font-medium border border-[#3c3a37]"
            >
              <RotateCcw className="w-4 h-4" />
              New Game
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 lg:p-10 grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Left Column: Board */}
        <div className="lg:col-span-7 flex flex-col items-center">
          <div className="flex gap-3 items-stretch">
            {/* Evaluation Bar */}
            <div 
              className="w-8 bg-[#262421] rounded-sm overflow-hidden flex flex-col-reverse border-2 border-[#262421] relative shadow-xl"
              style={{ height: boardWidth + 8 }}
            >
              <motion.div 
                initial={{ height: "50%" }}
                animate={{ height: `${getEvalPercentage(suggestion?.evaluation)}%` }}
                transition={{ type: "spring", stiffness: 50, damping: 15 }}
                className="bg-[#ebecd0] w-full"
              />
              <div className="absolute inset-0 flex flex-col justify-between py-2 items-center pointer-events-none mix-blend-difference text-[10px] font-bold text-white uppercase opacity-50">
                <span>B</span>
                <span>W</span>
              </div>
              {suggestion && typeof suggestion.evaluation === 'number' && (
                <div 
                  className="absolute left-0 right-0 text-center text-[10px] font-bold z-10 pointer-events-none mix-blend-difference text-white"
                  style={{ 
                    bottom: `${getEvalPercentage(suggestion.evaluation)}%`,
                    transform: 'translateY(50%)'
                  }}
                >
                  {Math.abs(suggestion.evaluation) > 10 ? (suggestion.evaluation > 0 ? 'M' : '-M') : suggestion.evaluation.toFixed(1)}
                </div>
              )}
            </div>

            <div className="relative shadow-2xl rounded-sm overflow-hidden border-4 border-[#262421]">
              <Chessboard 
                options={{
                  position: game.fen(),
                  onPieceDrop: onDrop,
                  boardStyle: { width: boardWidth },
                  boardOrientation: boardOrientation,
                  darkSquareStyle: { backgroundColor: "#779556" },
                  lightSquareStyle: { backgroundColor: "#ebecd0" }
                }}
              />
              
              {/* Game Status Overlay */}
              {game.isGameOver() && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-20">
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-[#1e1d1a] p-8 rounded-xl border border-[#3c3a37] text-center shadow-2xl"
                  >
                    <Trophy className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
                    <h2 className="text-3xl font-bold text-white mb-2">Game Over</h2>
                    <p className="text-lg text-[#bababa] mb-6">
                      {game.isCheckmate() ? "Checkmate!" : game.isDraw() ? "Draw" : "Game Ended"}
                    </p>
                    <button 
                      onClick={resetGame}
                      className="w-full py-3 bg-[#81b64c] hover:bg-[#95c264] text-white font-bold rounded-lg transition-colors"
                    >
                      Play Again
                    </button>
                  </motion.div>
                </div>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="mt-6 flex gap-4 w-full max-w-[560px]">
            <button 
              onClick={undoMove}
              disabled={moveHistory.length === 0}
              className="flex-1 py-3 bg-[#262421] hover:bg-[#2d2b28] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg border border-[#3c3a37] transition-all flex items-center justify-center gap-2"
            >
              <ChevronLeft className="w-5 h-5" />
              Undo
            </button>
            <button 
              onClick={getSuggestion}
              disabled={loading || game.isGameOver() || cooldown > 0}
              className="flex-[2] py-3 bg-[#81b64c] hover:bg-[#95c264] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#81b64c]/10"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Brain className="w-5 h-5" />
              )}
              {loading ? "Analyzing..." : cooldown > 0 ? `Wait ${cooldown}s` : "AI Move"}
            </button>
          </div>
        </div>

        {/* Right Column: Info & Analysis */}
        <div className="lg:col-span-5 space-y-6">
          {/* Move History */}
          <div className="bg-[#1e1d1a] rounded-xl border border-[#262421] overflow-hidden flex flex-col h-[200px]">
            <div className="px-4 py-3 border-b border-[#262421] bg-[#262421]/50 flex items-center gap-2">
              <History className="w-4 h-4 text-[#81b64c]" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">Move History</h3>
            </div>
            <div className="p-4 overflow-y-auto flex-1 grid grid-cols-4 gap-2 content-start">
              {moveHistory.length === 0 && (
                <p className="col-span-4 text-center text-[#666] italic text-sm py-4">No moves yet</p>
              )}
              {Array.from({ length: Math.ceil(moveHistory.length / 2) }).map((_, i) => (
                <React.Fragment key={`row-${i}`}>
                  <div className="text-[#666] text-xs font-mono flex items-center justify-center">{i + 1}.</div>
                  <div className="bg-[#262421] px-2 py-1 rounded text-sm text-center border border-[#3c3a37]">{moveHistory[i * 2]}</div>
                  <div className="bg-[#262421] px-2 py-1 rounded text-sm text-center border border-[#3c3a37]">
                    {moveHistory[i * 2 + 1] || ""}
                  </div>
                  <div />
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* AI Suggestion Area */}
          <div className="bg-[#1e1d1a] rounded-xl border border-[#262421] overflow-hidden min-h-[300px] flex flex-col">
            <div className="px-4 py-3 border-b border-[#262421] bg-[#262421]/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-[#81b64c]" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">Engine Analysis</h3>
              </div>
            </div>
            
            <div className="p-6 flex-1 relative">
              <AnimatePresence mode="wait">
                {!suggestion && !loading && !error && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full flex flex-col items-center justify-center text-center space-y-4 py-10"
                  >
                    <div className="w-16 h-16 bg-[#262421] rounded-full flex items-center justify-center">
                      <Brain className="w-8 h-8 text-[#4a4a4a]" />
                    </div>
                    <div>
                      <p className="text-white font-medium">Need a hint?</p>
                      <p className="text-sm text-[#666]">Click the AI Move button to let the engine play the best move for you.</p>
                    </div>
                  </motion.div>
                )}

                {loading && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full flex flex-col items-center justify-center text-center space-y-4 py-10"
                  >
                    <Loader2 className="w-12 h-12 text-[#81b64c] animate-spin" />
                    <p className="text-sm text-[#bababa]">Querying Lichess Cloud Eval...</p>
                  </motion.div>
                )}

                {error && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="bg-red-900/20 border border-red-900/50 p-4 rounded-lg text-red-400 text-sm"
                  >
                    {error}
                  </motion.div>
                )}

                {suggestion && !loading && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-[#666] uppercase tracking-widest font-bold">Best Move:</span>
                      <span className="bg-[#81b64c] text-white px-3 py-1 rounded font-mono font-bold text-lg">
                        {suggestion.move}
                      </span>
                    </div>
                    <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-p:text-[#bababa] prose-strong:text-white">
                      <ReactMarkdown>{suggestion.explanation}</ReactMarkdown>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto py-8 px-6 border-t border-[#262421] text-center">
        <p className="text-xs text-[#666]">
          Powered by Lichess Cloud Evaluation Database
        </p>
      </footer>
    </div>
  );
}
