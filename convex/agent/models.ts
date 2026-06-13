import { createOpenAI } from "@ai-sdk/openai";

/**
 * Central model configuration for the DevTrack AI agent (Track D).
 *
 * Uses Groq's OpenAI-compatible API (https://api.groq.com/openai/v1).
 * The provider reads GROQ_API_KEY lazily at request time, so these
 * module-level instances are safe to construct on deployments where the key
 * is not yet set — only actual LLM calls will fail.
 */
export const CHAT_MODEL_ID = "llama-3.3-70b-versatile";

/** 1536 dimensions — matches the frozen `by_embedding` vector index on `issues`. */
export const EMBEDDING_DIMENSIONS = 1536;

const groq = createOpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY,
});

export const chatModel = groq.chat(CHAT_MODEL_ID);

/**
 * Groq does not expose embedding models on most accounts. We generate
 * deterministic 1536-dim vectors locally so duplicate detection keeps working.
 */
export function embedTextLocally(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const normalized = text.toLowerCase().trim();
  if (!normalized) {
    return vec;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash * 31 + token.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % EMBEDDING_DIMENSIONS;
    vec[idx] += 1;
  }

  for (let i = 0; i < normalized.length - 2; i++) {
    const trigram = normalized.slice(i, i + 3);
    let hash = 0;
    for (let j = 0; j < trigram.length; j++) {
      hash = (hash * 31 + trigram.charCodeAt(j)) | 0;
    }
    const idx = Math.abs(hash) % EMBEDDING_DIMENSIONS;
    vec[idx] += 0.5;
  }

  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vec;
  }
  return vec.map((value) => value / norm);
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export const AI_NOT_CONFIGURED_MESSAGE =
  "The AI agent is not configured yet: the GROQ_API_KEY environment variable is missing on the Convex deployment.";

export function assertAiConfigured(): void {
  if (!isAiConfigured()) {
    throw new Error(AI_NOT_CONFIGURED_MESSAGE);
  }
}
