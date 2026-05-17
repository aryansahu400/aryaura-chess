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
  FlipVertical2,
  MessageSquare
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ChatDrawer } from "./components/ChatDrawer";

export default function App() {
  const [game, setGame] = useState(new Chess());
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState<{
    move: string;
    explanation: string;
    evaluation: number;
  } | null>(null);
  const [currentEvaluation, setCurrentEvaluation] = useState<number | null>(null);
  const [analysisResult, setAnalysisResult] = useState<{
    rating: number;
    opening: string;
    good: string[];
    bad: string[];
    description: string;
    changed: string;
  } | null>(null);
  const [analysisStreamText, setAnalysisStreamText] = useState("");
  const [analysisContext, setAnalysisContext] = useState<{
    fenBefore: string;
    fenAfter: string;
    move: string;
    sanMove: string;
  } | null>(null);
  const [analyzingMove, setAnalyzingMove] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boardWidth, setBoardWidth] = useState(560);
  const [cooldown, setCooldown] = useState(0);
  const [boardOrientation, setBoardOrientation] = useState<"white" | "black">("white");
  const [isChatOpen, setIsChatOpen] = useState(false);

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

  const updateEvaluation = async (fen: string) => {
    try {
      const response = await axios.post("/suggest-move", {
        fen,
      });
      setCurrentEvaluation(response.data.evaluation);
    } catch (err: any) {
      // Silently fail for background evaluation fetches
      console.log("Failed to fetch evaluation");
    }
  };

  const analyzeMoveWithGPT = async (fenBefore: string, fenAfter: string, move: string, sanMove: string) => {
    setAnalyzingMove(true);
    setAnalysisResult(null);
    setAnalysisStreamText("");
    try {
      const response = await fetch("/analyse-move", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fenBefore, fenAfter }),
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Streaming response not supported");
      }

      const decoder = new TextDecoder();
      let partial = "";
      let accumulated = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        partial += decoder.decode(value, { stream: true });

        const events = partial.split("\n\n");
        partial = events.pop() || "";

        for (const event of events) {
          if (!event.trim()) continue;
          const dataLines = event
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.replace(/^data:\s*/, ""));

          const chunkText = dataLines.length ? dataLines.join("") : event;
          if (chunkText.trim()) {
            accumulated += chunkText;
            setAnalysisStreamText(accumulated);
          }
        }
      }

      if (partial.trim()) {
        const dataLines = partial
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.replace(/^data:\s*/, ""));
        const chunkText = dataLines.length ? dataLines.join("") : partial;
        if (chunkText.trim()) {
          accumulated += chunkText;
          setAnalysisStreamText(accumulated);
        }
      }

      setAnalysisStreamText(accumulated || "No analysis was returned.");

      try {
        const parsed = JSON.parse(accumulated);
        setAnalysisResult({
          rating: Number(parsed.rating ?? 0),
          opening: typeof parsed.opening === "string" && parsed.opening.trim() !== "" ? parsed.opening : "Unknown Opening",
          good: Array.isArray(parsed.good) ? parsed.good.slice(0, 3).map(String) : [],
          bad: Array.isArray(parsed.bad) ? parsed.bad.slice(0, 3).map(String) : [],
          description: String(parsed.description ?? ""),
          changed: String(parsed.changed ?? ""),
        });
      } catch (parseError) {
        console.error("Failed to parse analysis JSON:", parseError);
        setError("Received invalid analysis JSON from the backend.");
      }
    } catch (err: any) {
      console.error("Failed to analyze move:", err.message);
      setError(err.message || "Failed to analyze move.");
    } finally {
      setAnalyzingMove(false);
    }
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
      const fenBefore = game.fen();
      const result = game.move(move);
      if (result) {
        const newGame = new Chess(game.fen());
        const uciMove = move.from + move.to + (move.promotion || "");
        setGame(newGame);
        setMoveHistory(prev => [...prev, result.san]);
        setAnalysisContext({
          fenBefore,
          fenAfter: newGame.fen(),
          move: uciMove,
          sanMove: result.san,
        });
        setAnalysisStreamText("");
        // Fetch evaluation of the new position
        updateEvaluation(newGame.fen());
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
      const response = await axios.post("/suggest-move", {
        fen: game.fen(),
      });
      const data = response.data;
      setSuggestion(data);
      setCurrentEvaluation(data.evaluation);

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
        setError(errorData?.details || "Rate limit reached. Please wait a moment.");
        setCooldown(10); // 10 second cooldown on 429
      } else if (err.response?.status === 404) {
        setError(errorData?.details || "Move suggestion unavailable for this position.");
      } else {
        setError(errorData?.error || errorData?.details || err.message || "Failed to get suggestion");
      }
    } finally {
      setLoading(false);
      setCooldown(prev => prev === 0 ? 2 : prev); // Small 2s cooldown after every successful/failed request
    }
  };

  const analyzeLastMove = async () => {
    if (!analysisContext) {
      setError("Make a move first, then click Analyze Move.");
      return;
    }
    setError(null);
    await analyzeMoveWithGPT(
      analysisContext.fenBefore,
      analysisContext.fenAfter,
      analysisContext.move,
      analysisContext.sanMove,
    );
  };

  const resetGame = () => {
    setGame(new Chess());
    setMoveHistory([]);
    setSuggestion(null);
    setCurrentEvaluation(null);
    setAnalysisContext(null);
    setAnalysisResult(null);
    setAnalysisStreamText("");
    setError(null);
  };

  const undoMove = () => {
    if (moveHistory.length === 0) return;
    
    // Reconstruct the game by replaying all moves except the last one
    const newGame = new Chess();
    const newMoveHistory = moveHistory.slice(0, -1);
    
    for (const move of newMoveHistory) {
      newGame.move(move, { sloppy: true });
    }
    
    setGame(newGame);
    setMoveHistory(newMoveHistory);
    setSuggestion(null);
    setAnalysisContext(null);
    setAnalysisResult(null);
    setAnalysisStreamText("");
    updateEvaluation(newGame.fen());
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
              onClick={() => setIsChatOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#4a4a4a] hover:bg-[#5a5a5a] transition-colors text-sm font-medium border border-[#3c3a37] text-amber-400"
              title="Open chat assistant"
            >
              <MessageSquare className="w-4 h-4" />
              Chat
            </button>
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
        <div className="lg:col-span-12">
          <div className="bg-[#1e1d1a] rounded-xl border border-[#262421] px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-[#81b64c]" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">Move History</h2>
            </div>
            <div className="flex-1 min-w-0 overflow-x-auto">
              <div className="flex gap-2 text-sm text-[#bababa] whitespace-nowrap">
                {moveHistory.length === 0 ? (
                  <span className="italic text-[#666]">No moves yet</span>
                ) : (
                  moveHistory.map((move, idx) => (
                    <span key={idx} className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-[#262421] border border-[#3c3a37]">
                      <span className="font-mono text-[#81b64c]">{Math.floor(idx / 2) + 1}{idx % 2 === 0 ? "." : "..."}</span>
                      <span>{move}</span>
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

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
                animate={{ height: `${getEvalPercentage(currentEvaluation)}%` }}
                transition={{ type: "spring", stiffness: 50, damping: 15 }}
                className="bg-[#ebecd0] w-full"
              />
              <div className="absolute inset-0 flex flex-col justify-between py-2 items-center pointer-events-none mix-blend-difference text-[10px] font-bold text-white uppercase opacity-50">
                <span>B</span>
                <span>W</span>
              </div>
              {currentEvaluation !== null && (
                <div 
                  className="absolute left-0 right-0 text-center text-[10px] font-bold z-10 pointer-events-none mix-blend-difference text-white"
                  style={{ 
                    bottom: `${getEvalPercentage(currentEvaluation)}%`,
                    transform: 'translateY(50%)'
                  }}
                >
                  {Math.abs(currentEvaluation) > 10 ? (currentEvaluation > 0 ? 'M' : '-M') : currentEvaluation.toFixed(1)}
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
              className="flex-1 py-3 bg-[#81b64c] hover:bg-[#95c264] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#81b64c]/10"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Brain className="w-5 h-5" />
              )}
              {loading ? "Finding best move..." : cooldown > 0 ? `Wait ${cooldown}s` : "Suggest Move"}
            </button>
            <button 
              onClick={analyzeLastMove}
              disabled={analyzingMove || !analysisContext || game.isGameOver()}
              className="flex-1 py-3 bg-[#1f4a73] hover:bg-[#2d628f] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-bold transition-all flex items-center justify-center gap-2 border border-[#3b5e8e]"
            >
              {analyzingMove ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Lightbulb className="w-5 h-5" />
              )}
              {analyzingMove ? "Analyzing..." : "Analyze Move"}
            </button>
          </div>
        </div>

        {/* Right Column: Info & Analysis */}
        <div className="lg:col-span-5 space-y-6">
          {/* AI Suggestion Area */}
          <div className="bg-[#1e1d1a] rounded-xl border border-[#262421] overflow-hidden min-h-[300px] flex flex-col">
            <div className="px-4 py-3 border-b border-[#262421] bg-[#262421]/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-[#81b64c]" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">Engine Analysis</h3>
              </div>
            </div>
            
            <div className="p-6 flex-1 relative overflow-y-auto">
              <AnimatePresence mode="wait">
                {!analysisStreamText && !suggestion && !loading && !error && !analyzingMove && (
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
                      <p className="text-white font-medium">Ready for move analysis</p>
                      <p className="text-sm text-[#666]">Make a move first, then click Analyze Move to stream the AI report.</p>
                    </div>
                  </motion.div>
                )}

                {(loading || analyzingMove) && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full flex flex-col items-center justify-center text-center space-y-4 py-10"
                  >
                    <Loader2 className="w-12 h-12 text-[#81b64c] animate-spin" />
                    <div className="max-w-lg px-4">
                      <p className="text-sm text-[#bababa]">
                        {loading ? "Finding the best move..." : "Streaming analysis from the AI backend..."}
                      </p>
                      {analysisStreamText && (
                        <div className="mt-4 rounded-xl bg-[#1a1b1e] border border-[#333a45] p-4 text-left text-sm text-[#d7d7d7] shadow-inner">
                          <pre className="whitespace-pre-wrap break-words">{analysisStreamText}</pre>
                        </div>
                      )}
                    </div>
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

                {analysisResult && !analyzingMove && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    <div className="flex items-center justify-between gap-4 bg-[#262421]/50 p-4 rounded-lg">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-[#81b64c]">Opening</p>
                        <p className="text-lg font-bold text-white">{analysisResult.opening}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs uppercase tracking-widest text-[#81b64c]">Rating</p>
                        <p className="text-3xl font-bold text-white">{analysisResult.rating.toFixed(1)}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="bg-[#1a1b1e] border border-[#333a45] rounded-xl p-4">
                        <p className="text-xs uppercase tracking-widest text-[#81b64c] mb-3">What went well</p>
                        <ul className="space-y-2 text-sm text-[#d7d7d7] list-disc list-inside">
                          {analysisResult.good.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="bg-[#1a1b1e] border border-[#333a45] rounded-xl p-4">
                        <p className="text-xs uppercase tracking-widest text-[#ffb547] mb-3">What to watch</p>
                        <ul className="space-y-2 text-sm text-[#d7d7d7] list-disc list-inside">
                          {analysisResult.bad.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="bg-[#262421]/50 border border-[#333a45] rounded-xl p-4 space-y-3">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-[#81b64c] mb-2">Strategic summary</p>
                        <p className="text-sm text-[#bababa]">{analysisResult.description}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-widest text-[#81b64c] mb-2">Board change</p>
                        <p className="text-sm text-[#bababa]">{analysisResult.changed}</p>
                      </div>
                    </div>
                  </motion.div>
                )}

                {!analysisResult && !analysisStreamText && suggestion && !loading && !analyzingMove && (
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
          Powered by the Spring Boot chess analysis backend
        </p>
      </footer>

      {/* Chat Drawer */}
      <ChatDrawer 
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        currentFen={game.fen()}
      />
    </div>
  );
}
