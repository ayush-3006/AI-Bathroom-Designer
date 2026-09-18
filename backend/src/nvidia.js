import OpenAI from "openai";

if (!process.env.NVIDIA_API_KEY) {
  throw new Error(
    "NVIDIA_API_KEY is missing. Create backend/.env (copy backend/.env.example) " +
      "and set NVIDIA_API_KEY=nvapi-... with a key from https://build.nvidia.com"
  );
}

const client = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

const MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.1-8b-instruct";

// Some NVIDIA-hosted models (the Nemotron 3 family, GPT-OSS, and others) reason
// by default, emitting a visible chain-of-thought that can eat the whole token
// budget before ever reaching the answer (see: the truncated-JSON bug this was
// added to fix). This flag is harmless for models that don't support it - it's
// just an extra field they'll ignore. Set NVIDIA_DISABLE_THINKING=false to omit it.
const DISABLE_THINKING = process.env.NVIDIA_DISABLE_THINKING !== "false";
const thinkingParams = DISABLE_THINKING ? { chat_template_kwargs: { enable_thinking: false } } : {};

function stripCodeFence(text) {
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

// Models don't always obey "JSON only" - sometimes they add a sentence before/after.
// Pull out the first {...} block rather than requiring the whole response to be pure JSON.
function extractJsonObject(text) {
  const cleaned = stripCodeFence(text);
  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? match[0] : cleaned;
}

/**
 * Reads the whole conversation and pulls out whatever constraint values
 * it can confidently find. Never invents a value that wasn't stated.
 * Returns only the fields it found (nulls for the rest) so the caller
 * can merge over existing known slots without clobbering them.
 */
export async function extractSlots(messages) {
  const transcript = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

  const system = `You extract structured constraints from a conversation about designing a bathroom.
Return ONLY a JSON object, no prose, no markdown fences, with exactly these keys:
{
  "widthFt": number or null,
  "lengthFt": number or null,
  "budget": number or null,
  "theme": one of "minimalist" | "luxury" | "zen" | null,
  "themeDescription": string or null,
  "showerWidthFt": number or null,
  "showerLengthFt": number or null,
  "wantsBathtub": true | false | null
}
Rules:
- widthFt/lengthFt: only set if the user gave bathroom dimensions in feet. If given in a different unit, convert to feet.
- budget: total budget in Indian Rupees as a plain number (e.g. "3 lakh" -> 300000, "50k" -> 50000).
- theme: map "minimalist", "modern", "simple" -> "minimalist"; "luxury", "classic", "premium", "opulent" -> "luxury"; "zen", "spa", "calm", "japanese", "natural" -> "zen". If the user hasn't expressed a style preference, use null.
- themeDescription: the user's own words describing the look/feel/style they want (lightly cleaned up), e.g. "spa-like and calming with natural stone textures". This is separate from the normalized theme field above and should preserve nuance the enum loses. Null if no style was described.
- showerWidthFt/showerLengthFt: the size of the shower area specifically (not the whole bathroom), only in feet. If the user gives a single number for the shower (e.g. "3 feet shower"), treat it as a square and set both to that value. If given in another unit, convert to feet. Only set these when the user is clearly answering about the shower area, not the overall room.
- wantsBathtub: only set true/false if the user has clearly answered a question about wanting a bathtub. Otherwise null.
- Never guess a value that was not stated or clearly implied.

If you need to reason about the input, keep it brief. Then, as the very last thing in your
response, output the JSON object on its own line with no other text after it.

Examples:
"5 x 7" -> {"widthFt": 5, "lengthFt": 7, "budget": null, "theme": null, "themeDescription": null, "showerWidthFt": null, "showerLengthFt": null, "wantsBathtub": null}
"my budget is 3 lakh" -> {"widthFt": null, "lengthFt": null, "budget": 300000, "theme": null, "themeDescription": null, "showerWidthFt": null, "showerLengthFt": null, "wantsBathtub": null}
"something spa-like and calming with natural stone" -> {"widthFt": null, "lengthFt": null, "budget": null, "theme": "zen", "themeDescription": "spa-like and calming with natural stone textures", "showerWidthFt": null, "showerLengthFt": null, "wantsBathtub": null}
"shower area is 3x4 feet" -> {"widthFt": null, "lengthFt": null, "budget": null, "theme": null, "themeDescription": null, "showerWidthFt": 3, "showerLengthFt": 4, "wantsBathtub": null}
"3 feet shower" -> {"widthFt": null, "lengthFt": null, "budget": null, "theme": null, "themeDescription": null, "showerWidthFt": 3, "showerLengthFt": 3, "wantsBathtub": null}

The JSON object must be the last thing you output. No text after it.`;

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_tokens: 1000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: transcript },
    ],
    ...thinkingParams,
  });

  const raw = completion.choices[0].message.content || "{}";
  try {
    return JSON.parse(extractJsonObject(raw));
  } catch {
    console.warn("[extractSlots] could not parse model output as JSON (truncated or non-JSON):\n", raw);
    return {};
  }
}

/**
 * Produces a warm, specific explanation of the recommended bundle.
 * The LLM never invents product names or prices - they're injected
 * into the prompt from the deterministic engine's output.
 */
export async function narrateBundle({ bundle, slots, isSmallRoom, overBudget }) {
  const lines = Object.entries(bundle.roles)
    .map(([role, item]) => `- ${role}: ${item.name || item.collection} (${item.finish_color || item.finish || ""}), Rs ${item.price_inr.toLocaleString("en-IN")}`)
    .join("\n");

  const system = `You are a warm, concise bathroom design consultant. Explain the recommended product bundle
in 3-5 sentences of natural prose. Reference specific products by name. Mention the total price.
${isSmallRoom ? "Mention that a bathtub was left out because the room is compact." : ""}
${slots.wantsBathtub === false ? "Mention the bathtub was skipped since the customer chose not to include one." : ""}
${overBudget ? "Gently mention this bundle slightly exceeds the stated budget and is the closest available fit." : ""}
Do not invent any product names, prices, or specs beyond what's given below. Keep it grounded and specific, not generic marketing copy.`;

  const user = `Room: ${slots.widthFt}ft x ${slots.lengthFt}ft. Budget: Rs ${slots.budget.toLocaleString("en-IN")}. Theme: ${slots.theme}${slots.themeDescription ? ` (customer described it as: "${slots.themeDescription}")` : ""}.
Bundle:
${lines}
Total: Rs ${bundle.total.toLocaleString("en-IN")}`;

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.6,
    max_tokens: 800,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...thinkingParams,
  });

  return completion.choices[0].message.content.trim();
}
