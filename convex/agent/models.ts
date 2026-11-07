import { createOpenAI } from "@ai-sdk/openai";
import { embedMany, type LanguageModel } from "ai";

/**
 * Central model configuration for the DevTrack AI agent.
 *
 * Everything is driven by environment variables on the Convex deployment
 * (`npx convex env set NAME value`), so models can be switched without code
 * changes. Two OpenAI-compatible providers are supported:
 *
 *   - Groq        (GROQ_API_KEY)        https://api.groq.com/openai/v1
 *   - OpenRouter  (OPENROUTER_API_KEY)  https://openrouter.ai/api/v1
 *
 * Chat models form an ordered chain: the primary model first, then the
 * fallbacks. When a model fails (rate limit, outage, retired model, bad key)
 * the next one in the chain is tried automatically. See `chatModelChain`.
 *
 * Env vars:
 *   AI_MODEL_PROVIDER   "groq" | "openrouter" — whose model goes first (default groq)
 *   GROQ_MODEL_NAME     Groq chat model       (default openai/gpt-oss-120b)
 *   AI_MODEL_NAME       OpenRouter chat model (default google/gemma-4-31b-it:free)
 *   AI_FALLBACK_MODELS  comma-separated "provider:model" list tried after the
 *                       two primaries (default: DEFAULT_FALLBACK_MODELS)
 *   AI_EMBED_MODEL      OpenRouter embedding model for duplicate detection.
 *                       Unset → local hashed embeddings (no API needed).
 *
 * Every chat model must support tool calling — the agent depends on it.
 */

/** 1536 dimensions — matches the frozen `by_embedding` vector index on `issues`. */
export const EMBEDDING_DIMENSIONS = 1536;

type AIProvider = "groq" | "openrouter";
type LanguageModelV3 = Extract<LanguageModel, { specificationVersion: "v3" }>;

const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
const DEFAULT_OPENROUTER_MODEL = "google/gemma-4-31b-it:free";

/**
 * Tool-capable free models verified against the live APIs. `parallel/decisions-fast`
 * and `respan/span-01-lite` are deliberately absent: they are OpenRouter
 * "decisions" models that reject chat/completions requests.
 */
const DEFAULT_FALLBACK_MODELS = [
  "openrouter:recursive/flint-v1.0:free",
  "openrouter:google/gemma-4-26b-a4b-it:free",
  "openrouter:liquid/lfm-3-1.7b:free",
];

const PROVIDER_KEYS: Record<AIProvider, string | undefined> = {
  groq: process.env.GROQ_API_KEY,
  openrouter: process.env.OPENROUTER_API_KEY,
};

const providers = {
  groq: createOpenAI({
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: PROVIDER_KEYS.groq,
  }),
  openrouter: createOpenAI({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: PROVIDER_KEYS.openrouter,
    headers: { "X-Title": "DevTrack" },
  }),
};

function isProvider(value: string): value is AIProvider {
  return value === "groq" || value === "openrouter";
}

const PRIMARY_PROVIDER: AIProvider = isProvider(
  process.env.AI_MODEL_PROVIDER?.trim() ?? ""
)
  ? (process.env.AI_MODEL_PROVIDER!.trim() as AIProvider)
  : "groq";

type ChainEntry = { provider: AIProvider; modelId: string };

/** "openrouter:google/gemma-4-31b-it:free" → { provider, modelId }. */
function parseEntry(raw: string): ChainEntry | null {
  const trimmed = raw.trim();
  const sep = trimmed.indexOf(":");
  if (sep <= 0) {
    return null;
  }
  const provider = trimmed.slice(0, sep);
  const modelId = trimmed.slice(sep + 1).trim();
  return isProvider(provider) && modelId ? { provider, modelId } : null;
}

function buildChain(): ChainEntry[] {
  const primaries: Record<AIProvider, ChainEntry> = {
    groq: {
      provider: "groq",
      modelId: process.env.GROQ_MODEL_NAME?.trim() || DEFAULT_GROQ_MODEL,
    },
    openrouter: {
      provider: "openrouter",
      modelId: process.env.AI_MODEL_NAME?.trim() || DEFAULT_OPENROUTER_MODEL,
    },
  };
  const secondary: AIProvider = PRIMARY_PROVIDER === "groq" ? "openrouter" : "groq";
  const fallbacks = (
    process.env.AI_FALLBACK_MODELS?.split(",") ?? DEFAULT_FALLBACK_MODELS
  )
    .map(parseEntry)
    .filter((entry): entry is ChainEntry => entry !== null);

  const seen = new Set<string>();
  return [primaries[PRIMARY_PROVIDER], primaries[secondary], ...fallbacks].filter(
    (entry) => {
      const key = `${entry.provider}:${entry.modelId}`;
      // Skip duplicates and providers without an API key.
      if (seen.has(key) || !PROVIDER_KEYS[entry.provider]) {
        return false;
      }
      seen.add(key);
      return true;
    }
  );
}

/** Ordered chat models in use, for diagnostics and logging. */
export const chatModelChain: Array<ChainEntry & { model: LanguageModelV3 }> =
  buildChain().map((entry) => ({
    ...entry,
    model: providers[entry.provider].chat(entry.modelId) as LanguageModelV3,
  }));

export const CHAT_MODEL_ID =
  chatModelChain.map((e) => `${e.provider}:${e.modelId}`).join(" → ") ||
  "not configured";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : String(error);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * A language model that delegates to each model in the chain until one
 * accepts the request. Failover happens before any tokens are produced
 * (request errors such as 429/404/5xx/401), so streamed replies never mix
 * output from two models. The AI SDK's own retry wraps this whole chain.
 */
function createFallbackModel(
  chain: Array<{ provider: AIProvider; modelId: string; model: LanguageModelV3 }>
): LanguageModelV3 {
  async function run<T>(
    call: (model: LanguageModelV3) => PromiseLike<T>
  ): Promise<T> {
    if (chain.length === 0) {
      throw new Error(AI_NOT_CONFIGURED_MESSAGE);
    }
    let lastError: unknown;
    for (const entry of chain) {
      try {
        return await call(entry.model);
      } catch (error) {
        if (isAbort(error)) {
          throw error;
        }
        lastError = error;
        console.warn(
          `AI model ${entry.provider}:${entry.modelId} failed, trying next: ${describeError(error)}`
        );
      }
    }
    throw lastError;
  }

  return {
    specificationVersion: "v3",
    provider: "devtrack-fallback",
    modelId: CHAT_MODEL_ID,
    supportedUrls: chain[0]?.model.supportedUrls ?? {},
    doGenerate: (options) => run((model) => model.doGenerate(options)),
    doStream: (options) => run((model) => model.doStream(options)),
  };
}

export const chatModel: LanguageModelV3 = createFallbackModel(chatModelChain);

// ── Embeddings ────────────────────────────────────────────────────────────

/**
 * One embedding model only — vectors from different models live in different
 * spaces and cannot be compared, so there is deliberately no fallback chain.
 * After changing AI_EMBED_MODEL, run `agent/embeddings:reembedAllIssues`.
 */
export const EMBEDDING_MODEL_ID: string | null =
  process.env.OPENROUTER_API_KEY && process.env.AI_EMBED_MODEL?.trim()
    ? process.env.AI_EMBED_MODEL.trim()
    : null;

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vec : vec.map((value) => value / norm);
}

/**
 * Embed texts into 1536-dim unit vectors with AI_EMBED_MODEL (OpenRouter,
 * `dimensions: 1536`), or locally when no embedding model is configured.
 * Throws if the configured model fails — callers must not mix in local
 * vectors, which would corrupt similarity scores.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  if (!EMBEDDING_MODEL_ID) {
    return texts.map(embedTextLocally);
  }
  const { embeddings } = await embedMany({
    model: providers.openrouter.embedding(EMBEDDING_MODEL_ID),
    values: texts.map((text) => text.slice(0, 8000) || " "),
    maxRetries: 2,
    providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } },
  });
  return embeddings.map((vec) => {
    if (vec.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding model ${EMBEDDING_MODEL_ID} returned ${vec.length} dimensions; the vector index needs ${EMBEDDING_DIMENSIONS}.`
      );
    }
    return normalize(vec);
  });
}

/**
 * Deterministic hashed 1536-dim vectors — the no-API fallback used when
 * AI_EMBED_MODEL is not set, so duplicate detection still works.
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

  return normalize(vec);
}

// ── Configuration status ──────────────────────────────────────────────────

export function isAiConfigured(): boolean {
  return chatModelChain.length > 0;
}

export const AI_NOT_CONFIGURED_MESSAGE =
  "The AI agent is not configured yet: set GROQ_API_KEY and/or OPENROUTER_API_KEY on the Convex deployment.";

export function assertAiConfigured(): void {
  if (!isAiConfigured()) {
    throw new Error(AI_NOT_CONFIGURED_MESSAGE);
  }
}
