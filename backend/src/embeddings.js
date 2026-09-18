import OpenAI from "openai";

if (!process.env.NVIDIA_API_KEY) {
  throw new Error("NVIDIA_API_KEY is missing. See backend/.env.example.");
}

const client = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

// NVIDIA's free-tier embedding catalog changes often - if this default 404s/410s,
// see the instructions in backend/.env.example for finding a currently-live model.
const EMBED_MODEL = process.env.NVIDIA_EMBED_MODEL || "nvidia/llama-3.2-nemoretriever-300m-embed-v1";

/**
 * Embeds a batch of texts in one request.
 * inputType must be "passage" for catalog/document text being indexed,
 * or "query" for the user's search text - the model treats them differently.
 */
export async function embedBatch(texts, inputType) {
  try {
    const res = await client.embeddings.create({
      model: EMBED_MODEL,
      input: texts,
      encoding_format: "float",
      input_type: inputType,
      truncate: "END",
    });
    return res.data.map((d) => d.embedding);
  } catch (err) {
    if (err.status === 404 || err.status === 410) {
      throw new Error(
        `NVIDIA embedding model "${EMBED_MODEL}" is no longer available (status ${err.status}). ` +
          `NVIDIA's free-tier catalog changes models frequently. Fix: go to https://build.nvidia.com/models, ` +
          `filter by "Text-to-Embedding" + "Free Endpoint", open a model, copy its exact id from the code sample, ` +
          `and set NVIDIA_EMBED_MODEL in backend/.env to that id.`
      );
    }
    throw err;
  }
}

export async function embedOne(text, inputType) {
  const [vec] = await embedBatch([text], inputType);
  return vec;
}

export function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}
