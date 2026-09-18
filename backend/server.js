import "dotenv/config";
import express from "express";
import cors from "cors";
import { recommend, getNextMissingSlot, SMALL_ROOM_THRESHOLD_SQFT } from "./src/engine.js";
import { extractSlots, narrateBundle } from "./src/nvidia.js";
import { buildCatalogIndex } from "./src/catalogIndex.js";

const app = express();
app.use(cors());
app.use(express.json());

// In-memory per-session state. Fine for a demo; swap for a real store in production.
const sessions = new Map();

function freshSession() {
  return {
    messages: [],
    slots: {
      widthFt: null,
      lengthFt: null,
      budget: null,
      theme: null,
      themeDescription: null,
      showerWidthFt: null,
      showerLengthFt: null,
      wantsBathtub: null,
    },
    resolved: false,
  };
}

const CANNED_QUESTIONS = {
  dimensions: "Let's start with the room. What are your bathroom's dimensions, in feet (e.g. 8 x 6)?",
  budget: "Got it. What's your total budget for the fixtures, in rupees?",
  theme: "What style are you drawn to: Minimalist Modern, Classic Luxury, or Japanese Zen?",
  showerSize: "How big should the shower area be, in feet only (e.g. 3 x 4)?",
  bathtub: (areaSqft) =>
    `Your bathroom is about ${Math.round(areaSqft)} sq ft, so there's room for a bathtub if you'd like one. Would you like to include a bathtub in the bundle?`,
};

app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) return res.status(400).json({ error: "sessionId and message are required" });

    if (!sessions.has(sessionId)) sessions.set(sessionId, freshSession());
    const session = sessions.get(sessionId);
    session.messages.push({ role: "user", content: message });

    // Pull whatever new constraints we can find from the whole conversation so far.
    const found = await extractSlots(session.messages);
    console.log("[chat] extracted:", found, "| merged slots will become:", { ...session.slots, ...Object.fromEntries(Object.entries(found).filter(([, v]) => v !== null && v !== undefined)) });
    for (const key of Object.keys(session.slots)) {
      if (found[key] !== undefined && found[key] !== null) {
        session.slots[key] = found[key];
      }
    }

    const missing = getNextMissingSlot(session.slots);

    if (missing) {
      const areaSqft = session.slots.widthFt && session.slots.lengthFt ? session.slots.widthFt * session.slots.lengthFt : 0;
      const reply = missing === "bathtub" ? CANNED_QUESTIONS.bathtub(areaSqft) : CANNED_QUESTIONS[missing];
      session.messages.push({ role: "assistant", content: reply });
      return res.json({ reply, done: false, slots: session.slots });
    }

    // All slots filled - run the deterministic engine, then narrate.
    const result = await recommend(session.slots);
    const narration = await narrateBundle({
      bundle: result.bundle,
      slots: session.slots,
      isSmallRoom: result.isSmallRoom,
      overBudget: result.overBudget,
    });

    session.messages.push({ role: "assistant", content: narration });
    session.resolved = true;

    res.json({
      reply: narration,
      done: true,
      slots: session.slots,
      bundle: result.bundle,
      isSmallRoom: result.isSmallRoom,
      overBudget: result.overBudget,
      smallRoomThresholdSqft: SMALL_ROOM_THRESHOLD_SQFT,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong talking to the design assistant.", detail: String(err.message || err) });
  }
});

app.post("/api/reset", (req, res) => {
  const { sessionId } = req.body;
  sessions.set(sessionId, freshSession());
  res.json({ ok: true });
});

const PORT = process.env.PORT || 8787;

buildCatalogIndex()
  .then(() => {
    app.listen(PORT, () => console.log(`Kohler AI designer backend running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to build catalog embeddings at startup:", err);
    process.exit(1);
  });
