# Kohler AI Bathroom Designer ,conversational prototype

A split-screen tool: chat with an AI design assistant on the left, watch a live
interactive 2D floor plan build itself on the right as it learns your room, budget,
and style. Built with React + Vite (frontend) and Express (backend), using NVIDIA's
NIM API (OpenAI-compatible) for both the LLM and RAG retrieval.

## How it works

Three layers, kept deliberately separate:

1. **RAG retrieval** (`backend/src/catalogIndex.js` + `embeddings.js`) — the entire
   42-product catalog is embedded once at server startup (`nvidia/nv-embedqa-e5-v5`).
   When a user describes a style ("something spa-like and calming with natural stone"),
   that description is embedded too and compared by cosine similarity against every
   product in each category. This is real semantic retrieval, not keyword matching —
   it catches style intent the old substring-matching approach would miss.

2. **Deterministic recommendation engine** (`backend/src/engine.js`) — plain code,
   no AI. Takes the RAG-ranked candidate pool per category, then picks a price tier
   that fits the budget, and decides whether a bathtub is even eligible based on
   room size. This is what makes the final picks explainable and reproducible.

3. **NVIDIA LLM layer** (`backend/src/nvidia.js`) — used for exactly two things:
   extracting structured constraints (dimensions, budget, theme, style description,
   bathtub preference) from free text, and narrating the final bundle in natural
   language. It never invents product names or prices — those always come from the
   engine, which only ever selects from the real catalog.

### The bathtub rule

- Rooms under **35 sq ft** (configurable in `engine.js`) never get a bathtub offered —
  it's excluded automatically, no question asked.
- Rooms **35 sq ft or larger** get asked explicitly: "would you like to include a
  bathtub?" and the engine only includes one if the answer was yes.

### The live floor plan (right panel)

Once the assistant knows your room dimensions, an empty room outline appears.
Once it has a full bundle, the toilet, vanity, and bathtub (if included) are placed
automatically using real dimensions from the catalog data — vanity on the plumbing
wall, toilet in a corner, tub along the opposite wall. From there:

- **Drag** any fixture anywhere within the room (pointer events, clamped to bounds)
- **Click** a fixture to see its name and price in a side panel
- Fixtures that overlap after dragging get a red outline as a visual warning
- **Reset layout** snaps everything back to the auto-placed positions
- Tank, mirror, faucet, and shower are listed underneath rather than drawn — they're
  wall/counter-mounted and don't have a meaningful floor footprint in the catalog data

## Setup

### 1. Get an NVIDIA API key
Sign up free at [build.nvidia.com](https://build.nvidia.com), open any chat model, and
grab the key (starts with `nvapi-`). The same key works for the embedding model used
for RAG - no separate signup.

### 2. Backend
```bash
cd backend
npm install
# edit .env and paste your NVIDIA_API_KEY
npm run dev
```
Runs on `http://localhost:8787`. On first boot it embeds the full catalog (a few
seconds) - watch for `[catalogIndex] ready.` in the terminal before testing.

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```
Runs on `http://localhost:5173` (Vite dev server proxies `/api` to the backend).

Open the printed URL and start chatting on the left; watch the plan build on the right.

## Catalog data

`backend/src/data/*.json` — toilets, tanks, faucets, showers, bathtubs, and styling
space (vanities + mirrors). All dimensions and prices are sourced from real Kohler
India price book / retail book data, cross-referenced by product code. `basins.json`
is included for completeness but not currently wired into the bundle logic.

## Known simplifications (worth knowing before you demo this)

- Session state is in-memory (`Map` in `server.js`) — restarting the backend clears
  all active conversations. Fine for a demo, swap for Redis/a DB for production.
- Slot extraction re-reads the whole conversation each turn rather than doing
  incremental updates — simpler and more robust, slightly more tokens per call.
- RAG retrieval keeps the top ~60% of each category by similarity before the price
  logic picks a tier — this narrows to "on-theme" items without hard-excluding
  borderline matches. Tune `RELEVANCE_KEEP_FRACTION` in `engine.js`.
- Door position on the floor plan is fixed to the bottom wall — the chatbot doesn't
  currently ask which wall the door is on.
- Only toilet, vanity, and bathtub are drawn on the grid (they're the only categories
  with real floor-footprint data in the catalog). Dragging doesn't block overlaps,
  it just flags them visually - freeform rearrangement was prioritized over strict
  constraint enforcement.
- Reasoning-style NVIDIA models (anything that "thinks out loud" before answering)
  work but are slower and use more tokens than a plain instruct model for this kind
  of structured-extraction task. A non-reasoning instruct model is recommended.


## Video Demonstration Link-
-https://drive.google.com/file/d/1cZhJzyW5vpeRltlqs8BlhOtH_BZs-peI/view?usp=sharing
