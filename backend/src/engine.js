import { getGroupedCatalog, retrieveByCategory } from "./catalogIndex.js";
import { embedOne } from "./embeddings.js";

// A bathroom below this footprint is treated as too tight to fit a tub
// alongside a toilet + vanity with reasonable clearances. Tune as needed.
export const SMALL_ROOM_THRESHOLD_SQFT = 35;

const CATEGORIES = ["toilet", "tank", "vanity", "mirror", "faucet", "shower"];

// Of each category, only the top fraction (by semantic relevance to the
// user's style query) is eligible to be picked from - keeps genuinely
// off-theme products out of the running before price-tier selection happens.
const RELEVANCE_KEEP_FRACTION = 0.6;
const RELEVANCE_MIN_KEEP = 2;

function relevantPool(category, allItemsInCategory, queryVector) {
  if (!queryVector) return allItemsInCategory;
  const ranked = retrieveByCategory(category, queryVector);
  const keep = Math.max(RELEVANCE_MIN_KEEP, Math.ceil(ranked.length * RELEVANCE_KEEP_FRACTION));
  return ranked.slice(0, keep);
}

function pickForCategory(category, allItemsInCategory, queryVector, tierIndex) {
  const pool = relevantPool(category, allItemsInCategory, queryVector);
  const sorted = [...pool].sort((a, b) => a.price_inr - b.price_inr);
  const idx = Math.min(tierIndex, sorted.length - 1);
  return sorted[idx];
}

function buildBundle(catalog, queryVector, tierIndex, includeBathtub) {
  const roles = {};
  for (const category of CATEGORIES) {
    roles[category] = pickForCategory(category, catalog[category], queryVector, tierIndex);
  }
  if (includeBathtub) {
    roles.bathtub = pickForCategory("bathtub", catalog.bathtub, queryVector, tierIndex);
  }
  const total = Object.values(roles).reduce((sum, item) => sum + item.price_inr, 0);
  return { roles, total };
}

/**
 * slots: { widthFt, lengthFt, budget, theme, themeDescription, wantsBathtub }
 * `themeDescription` (the user's own words) is what actually drives retrieval;
 * `theme` (the normalized enum) is used as a fallback and for display.
 */
export async function recommend(slots) {
  const { widthFt, lengthFt, budget, theme, themeDescription, wantsBathtub } = slots;
  const areaSqft = widthFt * lengthFt;
  const isSmallRoom = areaSqft < SMALL_ROOM_THRESHOLD_SQFT;
  const includeBathtub = isSmallRoom ? false : Boolean(wantsBathtub);

  const catalog = getGroupedCatalog();
  const queryText = themeDescription || theme || "";
  const queryVector = queryText ? await embedOne(queryText, "query") : null;

  const tiers = [0, 1, 2].map((idx) => buildBundle(catalog, queryVector, idx, includeBathtub));
  const withinBudget = tiers.filter((t) => t.total <= budget).sort((a, b) => b.total - a.total);
  const overBudget = withinBudget.length === 0;
  const bundle = withinBudget[0] || [...tiers].sort((a, b) => a.total - b.total)[0];

  return { bundle, overBudget, isSmallRoom, areaSqft, includeBathtub };
}

export function getNextMissingSlot(slots) {
  if (!slots.widthFt || !slots.lengthFt) return "dimensions";
  if (!slots.budget) return "budget";
  if (!slots.theme) return "theme";
  if (!slots.showerWidthFt || !slots.showerLengthFt) return "showerSize";
  const area = slots.widthFt * slots.lengthFt;
  if (area >= SMALL_ROOM_THRESHOLD_SQFT && slots.wantsBathtub === null) return "bathtub";
  return null;
}
