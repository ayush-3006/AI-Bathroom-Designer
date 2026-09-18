import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { embedBatch, cosineSimilarity } from "./embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");

function load(file) {
  return JSON.parse(readFileSync(path.join(dataDir, file), "utf-8"));
}

function flattenCatalog() {
  const items = [];
  const push = (category, arr) => arr.forEach((p) => items.push({ ...p, category }));

  push("toilet", load("toilets.json").products);
  push("tank", load("tanks.json").products);
  push("faucet", load("faucets.json").products);
  push("shower", load("showers.json").products);
  push("bathtub", load("bathtubs.json").products);

  const styling = load("styling_space.json").subcategories;
  push("vanity", styling.vanities.products);
  push("mirror", styling.mirrors.products);

  return items;
}

// The text that actually gets embedded per product - this is what the
// retrieval is "reading", so it needs to carry the descriptive signal
// (finish, collection, type) that a style query should match against.
function describeProduct(p) {
  const finish = p.finish_color || p.finish || "";
  const type = p.type || "";
  const collection = p.collection || "";
  const desc = p.description || "";
  return `${collection} ${p.name || ""} ${type} ${p.category} ${desc}, finish: ${finish}, price tier: ${p.tier || ""}`
    .replace(/\s+/g, " ")
    .trim();
}

let cache = null; // { items: [...with .category], vectors: [...], grouped: { toilet: [...], ... } }

export async function buildCatalogIndex() {
  const items = flattenCatalog();
  const texts = items.map(describeProduct);

  console.log(`[catalogIndex] embedding ${items.length} catalog items via NVIDIA NIM...`);
  const vectors = await embedBatch(texts, "passage");

  const grouped = {};
  for (const item of items) {
    (grouped[item.category] ||= []).push(item);
  }

  cache = { items, vectors, grouped };
  console.log("[catalogIndex] ready.");
  return cache;
}

export function getGroupedCatalog() {
  if (!cache) throw new Error("Catalog index not built yet - call buildCatalogIndex() at server startup.");
  return cache.grouped;
}

/**
 * Ranks every item in `category` by cosine similarity to a precomputed
 * query vector. Returns the full ranked list (caller decides how many to keep).
 */
export function retrieveByCategory(category, queryVector) {
  if (!cache) throw new Error("Catalog index not built yet - call buildCatalogIndex() at server startup.");
  return cache.items
    .map((item, i) => ({ item, score: cosineSimilarity(queryVector, cache.vectors[i]) }))
    .filter((s) => s.item.category === category)
    .sort((a, b) => b.score - a.score)
    .map((s) => ({ ...s.item, _relevance: s.score }));
}
