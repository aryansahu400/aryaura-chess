import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import { Chess } from "chess.js";

dotenv.config();

// Use process.cwd() for reliable path resolution in local environments
const __dirname = path.resolve();

// Simple in-memory cache to avoid redundant Lichess API calls
const cache = new Map<string, any>();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.post("/api/suggest-move", async (req, res) => {
    const { fen } = req.body;

    if (!fen) {
      return res.status(400).json({ error: "FEN string is required" });
    }

    // Check cache first
    if (cache.has(fen)) {
      console.log("Serving from cache:", fen);
      return res.json(cache.get(fen));
    }

    let retries = 0;
    const maxRetries = 3;

    const fetchFromLichess = async (): Promise<any> => {
      try {
        const lichessUrl = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}`;
        const lichessResponse = await axios.get(lichessUrl);
        return lichessResponse.data;
      } catch (error: any) {
        if (error.response?.status === 429 && retries < maxRetries) {
          retries++;
          // Exponential backoff with jitter
          const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;
          console.log(`Rate limited by Lichess. Retrying in ${Math.round(delay)}ms... (Attempt ${retries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return fetchFromLichess();
        }
        throw error;
      }
    };

    const fetchFromStockfishOnline = async (retryCount = 0): Promise<any> => {
      try {
        const stockfishUrl = `https://stockfish.online/api/s/v2.php?fen=${encodeURIComponent(fen)}&depth=15`;
        const response = await axios.get(stockfishUrl);
        const data = response.data;
        
        if (data.success) {
          // Map to Lichess-like format for easier processing
          // bestmove format: "bestmove d8c7 ponder f1e1"
          const bestMoveParts = data.bestmove.split(" ");
          const uciMove = bestMoveParts[1]; 
          
          // The continuation usually starts with the best move
          const moves = data.continuation || uciMove;

          return {
            pvs: [{
              moves: moves,
              cp: data.mate === null ? Math.round(data.evaluation * 100) : undefined,
              mate: data.mate !== null ? data.mate : undefined
            }],
            depth: 15,
            knodes: 0,
            source: "Stockfish Online"
          };
        }
        
        if (retryCount < 2) {
          console.log(`Stockfish Online returned success: false. Retrying... (Attempt ${retryCount + 1})`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return fetchFromStockfishOnline(retryCount + 1);
        }
        
        throw new Error("Stockfish Online API returned success: false");
      } catch (error: any) {
        if (error.response?.status === 429 && retryCount < 2) {
          console.log(`Rate limited by Stockfish Online. Retrying... (Attempt ${retryCount + 1})`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return fetchFromStockfishOnline(retryCount + 1);
        }
        console.error("Stockfish Online API Error:", error.message);
        throw error;
      }
    };

    try {
      // 1. Try Lichess Cloud Evaluation API first
      let data;
      let source = "Lichess Cloud Eval";
      
      try {
        data = await fetchFromLichess();
      } catch (error: any) {
        const status = error.response?.status;
        if (status === 404 || status === 429) {
          console.log(`Lichess ${status}, falling back to Stockfish Online...`);
          data = await fetchFromStockfishOnline();
          source = "Stockfish Online";
        } else {
          throw error;
        }
      }
      
      const uciMove = data.pvs?.[0]?.moves?.split(" ")[0];
      const cp = data.pvs?.[0]?.cp;
      const mate = data.pvs?.[0]?.mate;
      const depth = data.depth || 0;
      const knodes = data.knodes || 0;
      const pvMoves = data.pvs?.[0]?.moves?.split(" ").slice(0, 5).join(" ") || ""; // Show next 5 moves

      if (!uciMove) {
        return res.status(404).json({ error: "No move found in cloud evaluation for this position." });
      }

      // Use chess.js to get SAN and move details
      const chess = new Chess(fen);
      const from = uciMove.substring(0, 2);
      const to = uciMove.substring(2, 4);
      const promotion = uciMove.substring(4) || "q";
      
      let moveDetails;
      try {
        moveDetails = chess.move({ from, to, promotion });
      } catch (e) {
        // Handle non-standard castling if necessary (though chess.js 1.0.0 handles UCI better)
        // If it fails, we still have the UCI move
      }

      const sanMove = moveDetails ? moveDetails.san : uciMove;
      const evaluationText = mate !== undefined ? `Mate in ${mate}` : (cp !== undefined ? (cp / 100).toFixed(2) : "0.00");
      const evaluationValue = mate !== undefined ? (mate > 0 ? 99 : -99) : (cp !== undefined ? cp / 100 : 0);
      
      // Build a descriptive explanation
      let moveType = "a standard move";
      if (moveDetails) {
        if (moveDetails.captured) moveType = `capturing the ${moveDetails.captured}`;
        if (moveDetails.flags.includes("c")) moveType = "kingside castling";
        if (moveDetails.flags.includes("q")) moveType = "queenside castling";
        if (moveDetails.flags.includes("e")) moveType = "an en passant capture";
        if (moveDetails.flags.includes("p")) moveType = "a promotion";
        if (moveDetails.san.includes("+")) moveType += " and giving check";
        if (moveDetails.san.includes("#")) moveType += " and delivering checkmate";
      }

      // Get alternative moves if available
      const alternatives = data.pvs?.slice(1, 4).map((pv: any, idx: number) => {
        const altUci = pv.moves?.split(" ")[0] || "???";
        const altEval = pv.mate !== undefined ? `M${pv.mate}` : (pv.cp !== undefined ? (pv.cp / 100).toFixed(2) : "0.00");
        return `${idx + 2}. \`${altUci}\` (${altEval})`;
      }).join(", ") || "None found";

      const explanation = `
### Engine Analysis: **${sanMove}**
The engine suggests **${sanMove}**, which is ${moveType}.

**Technical Stats:**
- **Evaluation**: \`${evaluationText}\`
- **Depth**: \`${depth}\`
- **Nodes**: \`${knodes > 0 ? knodes.toLocaleString() : "N/A"}\`
- **Continuation**: \`${pvMoves}...\`

**Alternative Lines:**
${alternatives}

This move was selected by ${source} based on deep engine analysis.
      `;

      const result = {
        move: uciMove,
        evaluation: evaluationValue,
        explanation,
      };

      // Store in cache
      cache.set(fen, result);
      if (cache.size > 500) {
        const firstKey = cache.keys().next().value;
        if (firstKey) cache.delete(firstKey);
      }

      res.json(result);
    } catch (error: any) {
      const status = error.response?.status;
      const message = error.message;
      const errorType = error.code || 'UNKNOWN_ERROR';
      
      console.error(`Chess Engine Error [${status || errorType}]:`, message);
      console.error("Full error details:", error);

      if (status === 429) {
        return res.status(429).json({ 
          error: "Rate limit reached.", 
          details: "The engine is currently busy. Please wait a few seconds before trying again." 
        });
      }
      if (status === 404) {
        return res.status(404).json({ 
          error: "Analysis not found.", 
          details: "This specific position hasn't been analyzed yet. Try making a few more moves or exploring a different line." 
        });
      }
      
      // Network or other errors
      if (!status) {
        console.error("No HTTP response received. Possible causes: network issue, API unreachable, or timeout.");
        return res.status(503).json({ 
          error: "Engine service unavailable.", 
          details: "Could not reach the chess engine. Please check your internet connection and try again." 
        });
      }
      
      res.status(500).json({ 
        error: "Engine communication error.", 
        details: message || "An unexpected error occurred while contacting the chess engine." 
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
