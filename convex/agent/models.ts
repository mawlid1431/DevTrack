import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, RetryError, embedMany, type LanguageModel } from "ai";

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
 * fallbacks. Every failure is classified (rate limit, outage, timeout, bad
 * key, retired/unsupported model) and the model is sidelined for a cooldown,
 * so the next healthy model answers immediately. Non-streaming calls race
 * several models in parallel; streaming chat fails over one by one. See
 * `runWithFailover` and `agent/diagnostics:checkModels`.
 *
 * Env vars:
 *   AI_MODEL_PROVIDER   "groq" | "openrouter", whose model goes first (default groq)
 *   GROQ_MODEL_NAME     Groq chat model       (default openai/gpt-oss-120b)
 *   AI_MODEL_NAME       OpenRouter chat model (default google/gemma-4-31b-it:free)
 *   AI_FALLBACK_MODELS  comma-separated "provider:model" list tried after the
 *                       two primaries (default: DEFAULT_FALLBACK_MODELS)
 *   AI_EMBED_MODEL      OpenRouter embedding model for duplicate detection.
 *                       Unset → local hashed embeddings (no API needed).
 *   AI_PARALLEL_MODELS  how many models race per non-streaming call (default 2)
 *   AI_MODEL_TIMEOUT_MS max wait for a model to start answering (default 30000)
 *
 * Every chat model must support tool calling, the agent depends on it.
 */

/** 1536 dimensions, matches the frozen `by_embedding` vector index on `issues`. */
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

// Error handling: classification

/** Why a model call failed, drives cooldowns, failover and user messages. */
export type AiFailureKind =
  | "rate_limited"
  | "auth"
  | "not_found"
  | "unsupported"
  | "server_error"
  | "timeout"
  | "network"
  | "unknown";

export type AiFailure = {
  kind: AiFailureKind;
  status?: number;
  retryAfterMs?: number;
  message: string;
};

/** Max time to wait for a model to START answering before moving on. */
const STREAM_START_TIMEOUT_MS = Number(process.env.AI_MODEL_TIMEOUT_MS) || 30_000;
/** Max time for a complete non-streaming generation (triage, tool steps). */
const GENERATE_TIMEOUT_MS = STREAM_START_TIMEOUT_MS * 2;

/** Plain-language reason per failure kind (diagnostics + logs). */
export const FAILURE_REASONS: Record<AiFailureKind, string> = {
  rate_limited:
    "Rate limit or quota reached (HTTP 429/402): the provider refuses more requests for now. Free models hit this often.",
  auth: "API key rejected (HTTP 401/403): the key is wrong, revoked, or has no access to this model.",
  not_found:
    "Model not found (HTTP 404): the model id is wrong, the provider retired it, or no endpoint supports tool calling.",
  unsupported:
    "Request rejected (HTTP 400/422): this model cannot do tool-calling chat (e.g. an OpenRouter 'decisions' model) or the id is invalid.",
  server_error:
    "Provider outage (HTTP 5xx): the model's provider is down or overloaded.",
  timeout: `No response within ${Math.round(STREAM_START_TIMEOUT_MS / 1000)}s: the provider is too slow right now.`,
  network: "Network error: the provider could not be reached.",
  unknown: "Unexpected error.",
};

class ModelTimeoutError extends Error {
  constructor(model: string, ms: number) {
    super(`${model} did not respond within ${ms}ms`);
    this.name = "ModelTimeoutError";
  }
}

function parseRetryAfterMs(
  headers: Record<string, string> | undefined
): number | undefined {
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (!raw) {
    return undefined;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Unwrap AI SDK retry wrappers and `cause` chains to the real error. */
function rootError(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 5; depth++) {
    if (RetryError.isInstance(current)) {
      current = current.lastError;
    } else if (
      current instanceof Error &&
      !APICallError.isInstance(current) &&
      !(current instanceof AllModelsFailedError) &&
      current.cause
    ) {
      current = current.cause;
    } else {
      break;
    }
  }
  return current;
}

export function classifyAiError(error: unknown): AiFailure {
  const root = rootError(error);
  const message = (root instanceof Error ? root.message : String(root)).slice(0, 300);
  if (root instanceof ModelTimeoutError) {
    return { kind: "timeout", message };
  }
  if (root instanceof AllModelsFailedError) {
    // Every model failed the same way → report that kind; mixed → unknown.
    const kinds = new Set(root.failures.map((f) => f.kind));
    return {
      kind: kinds.size === 1 ? [...kinds][0] : "unknown",
      message,
    };
  }
  if (APICallError.isInstance(root)) {
    const status = root.statusCode;
    if (status === 429 || status === 402) {
      return {
        kind: "rate_limited",
        status,
        retryAfterMs: parseRetryAfterMs(root.responseHeaders),
        message,
      };
    }
    if (status === 401 || status === 403) return { kind: "auth", status, message };
    if (status === 404) return { kind: "not_found", status, message };
    if (status === 400 || status === 422) return { kind: "unsupported", status, message };
    if (status !== undefined && status >= 500) return { kind: "server_error", status, message };
    if (status === undefined) return { kind: "network", message };
  }
  if (/fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|socket|network/i.test(message)) {
    return { kind: "network", message };
  }
  return { kind: "unknown", message };
}

/** Thrown when every model in the chain failed for one request. */
export class AllModelsFailedError extends Error {
  readonly failures: Array<AiFailure & { model: string }>;
  constructor(failures: Array<AiFailure & { model: string }>) {
    super(
      `All AI models failed: ${failures.map((f) => `${f.model} (${f.kind})`).join(", ") || "none available"}`
    );
    this.name = "AllModelsFailedError";
    this.failures = failures;
  }
}

/**
 * Message safe to show end users for any AI failure (chat, triage,
 * duplicate detection). Never leaks keys, URLs or provider internals.
 */
export function userFacingAiError(error: unknown): string {
  if (!isAiConfigured()) {
    return AI_NOT_CONFIGURED_MESSAGE;
  }
  const root = rootError(error);
  const kinds =
    root instanceof AllModelsFailedError
      ? new Set(root.failures.map((f) => f.kind))
      : new Set([classifyAiError(root).kind]);
  const only = (...allowed: AiFailureKind[]) =>
    kinds.size > 0 && [...kinds].every((k) => allowed.includes(k));

  if (only("rate_limited")) {
    return "All AI models have reached their usage limit for the moment. Please try again in about a minute.";
  }
  if (only("server_error", "timeout", "network")) {
    return "The AI providers are not responding right now. Please try again shortly.";
  }
  if (only("auth", "not_found", "unsupported")) {
    return "The AI models are misconfigured (API keys or model names). An admin should run `npx convex run agent/diagnostics:checkModels`.";
  }
  if (root instanceof AllModelsFailedError) {
    return "Every AI model is unavailable right now (rate limits or outages). Please try again in a minute.";
  }
  return "Something went wrong while generating a response. Please try again.";
}

// Error handling: health + cooldowns

/**
 * How long a failing model is sidelined. Rate limits honour Retry-After;
 * permanent problems (bad key, retired model) back off for 10 minutes.
 * Sidelined models are still tried LAST, so a request never fails while any
 * model might answer.
 *
 * State lives in module memory, i.e. per warm Convex isolate, a best-effort
 * fast path. Correctness never depends on it.
 */
const COOLDOWN_MS: Record<AiFailureKind, number> = {
  rate_limited: 60_000,
  server_error: 30_000,
  timeout: 30_000,
  network: 15_000,
  unknown: 15_000,
  auth: 10 * 60_000,
  not_found: 10 * 60_000,
  unsupported: 10 * 60_000,
};
const MAX_COOLDOWN_MS = 10 * 60_000;

const modelHealth = new Map<string, { until: number; failure: AiFailure }>();

function modelKey(entry: ChainEntry): string {
  return `${entry.provider}:${entry.modelId}`;
}

function markFailed(entry: ChainEntry, failure: AiFailure): void {
  const ms = Math.min(failure.retryAfterMs ?? COOLDOWN_MS[failure.kind], MAX_COOLDOWN_MS);
  modelHealth.set(modelKey(entry), { until: Date.now() + ms, failure });
}

function markHealthy(entry: ChainEntry): void {
  modelHealth.delete(modelKey(entry));
}

/** Snapshot of models currently cooling down (diagnostics). */
export function coolingModels(): Array<{ model: string; kind: AiFailureKind; secondsLeft: number }> {
  const now = Date.now();
  return [...modelHealth.entries()]
    .filter(([, h]) => h.until > now)
    .map(([model, h]) => ({
      model,
      kind: h.failure.kind,
      secondsLeft: Math.ceil((h.until - now) / 1000),
    }));
}

/** Healthy models in configured order first, then cooling ones (soonest first). */
function orderedCandidates<T extends ChainEntry>(chain: T[]): T[] {
  const now = Date.now();
  const cooling = (e: T) => (modelHealth.get(modelKey(e))?.until ?? 0) > now;
  const healthy = chain.filter((e) => !cooling(e));
  const sidelined = chain
    .filter(cooling)
    .sort(
      (a, b) =>
        (modelHealth.get(modelKey(a))?.until ?? 0) -
        (modelHealth.get(modelKey(b))?.until ?? 0)
    );
  return [...healthy, ...sidelined];
}

// Parallel + failover execution

/** How many models race at once for non-streaming calls (1 = no racing). */
const PARALLEL_MODELS = Math.min(
  4,
  Math.max(1, Number(process.env.AI_PARALLEL_MODELS) || 2)
);

type ChainModel = ChainEntry & { model: LanguageModelV3 };
type ModelCall<T> = (model: LanguageModelV3, signal: AbortSignal) => PromiseLike<T>;

/**
 * Run one model call with its own AbortController: it aborts on the caller's
 * signal, on a race being won by another model, or on timeout. The timeout
 * only bounds the time until the call resolves, for streams that is the
 * first response, so long answers keep streaming.
 */
async function callModel<T>(
  entry: ChainModel,
  call: ModelCall<T>,
  parent: AbortSignal | undefined,
  timeoutMs: number,
  cancelled?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (parent?.aborted || cancelled?.aborted) {
    controller.abort();
  }
  parent?.addEventListener("abort", forward, { once: true });
  cancelled?.addEventListener("abort", forward, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new ModelTimeoutError(modelKey(entry), timeoutMs);
      controller.abort();
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(call(entry.model, controller.signal)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve with the first fulfilled promise (and its index); reject only if all reject. */
function firstSuccess<T>(promises: Promise<T>[]): Promise<{ index: number; value: T }> {
  return new Promise((resolve, reject) => {
    let pending = promises.length;
    if (pending === 0) {
      reject(new Error("no candidates"));
    }
    promises.forEach((p, index) => {
      p.then((value) => resolve({ index, value }), () => {
        pending -= 1;
        if (pending === 0) {
          reject(new Error("all candidates failed"));
        }
      });
    });
  });
}

/**
 * Execute `call` across the chain.
 * - parallel = false (streaming): one model at a time, instant failover.
 * - parallel = true  (non-streaming): race PARALLEL_MODELS models, keep the
 *   first success and cancel the rest; if the whole batch fails, race the next.
 * Every failure is classified and the model is sidelined for a cooldown.
 */
async function runWithFailover<T>(
  chain: ChainModel[],
  call: ModelCall<T>,
  parent: AbortSignal | undefined,
  { parallel, timeoutMs }: { parallel: boolean; timeoutMs: number }
): Promise<T> {
  if (chain.length === 0) {
    throw new Error(AI_NOT_CONFIGURED_MESSAGE);
  }
  const failures: Array<AiFailure & { model: string }> = [];
  const candidates = orderedCandidates(chain);
  const batchSize = parallel ? PARALLEL_MODELS : 1;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    // One canceller per racer: when a model wins, ONLY the losers are
    // cancelled, the winner's stream must keep flowing.
    const cancellers = batch.map(() => new AbortController());
    const attempts = batch.map(async (entry, index) => {
      const cancelled = cancellers[index].signal;
      try {
        const result = await callModel(entry, call, parent, timeoutMs, cancelled);
        markHealthy(entry);
        return result;
      } catch (error) {
        // Lost the race or the caller cancelled: not the model's fault.
        if (!cancelled.aborted && !parent?.aborted) {
          const failure = classifyAiError(error);
          markFailed(entry, failure);
          failures.push({ ...failure, model: modelKey(entry) });
          console.warn(
            `AI model ${modelKey(entry)} failed [${failure.kind}${failure.status ? ` ${failure.status}` : ""}], moving on: ${failure.message}`
          );
        }
        throw error;
      }
    });
    try {
      const winner = await firstSuccess(attempts);
      cancellers.forEach((c, index) => {
        if (index !== winner.index) {
          c.abort();
        }
      });
      return winner.value;
    } catch {
      if (parent?.aborted) {
        throw new Error("AI request cancelled");
      }
    }
  }
  throw new AllModelsFailedError(failures);
}

/**
 * The model every DevTrack AI feature uses (chat agent, triage assist).
 * Streaming chat fails over model by model before any token is produced, so
 * replies never mix two models. Non-streaming calls race models in parallel.
 */
function createResilientModel(chain: ChainModel[]): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "devtrack-resilient",
    modelId: CHAT_MODEL_ID,
    supportedUrls: chain[0]?.model.supportedUrls ?? {},
    doGenerate: (options) =>
      runWithFailover(
        chain,
        (model, signal) => model.doGenerate({ ...options, abortSignal: signal }),
        options.abortSignal,
        { parallel: true, timeoutMs: GENERATE_TIMEOUT_MS }
      ),
    doStream: (options) =>
      runWithFailover(
        chain,
        (model, signal) => model.doStream({ ...options, abortSignal: signal }),
        options.abortSignal,
        { parallel: false, timeoutMs: STREAM_START_TIMEOUT_MS }
      ),
  };
}

export const chatModel: LanguageModelV3 = createResilientModel(chatModelChain);

/**
 * Models from the user's list that are deliberately NOT used, with the
 * verified reason (reported by diagnostics).
 */
export const EXCLUDED_MODELS: Array<{ model: string; reason: string }> = [
  {
    model: "openrouter:parallel/decisions-fast:free",
    reason:
      "OpenRouter 'decisions' model: rejected on chat/completions (HTTP 400, needs /api/alpha/decisions), so it cannot run the tool-calling agent.",
  },
  {
    model: "openrouter:respan/span-01-lite:free",
    reason:
      "OpenRouter 'decisions' model: rejected on chat/completions (HTTP 400, needs /api/alpha/decisions), so it cannot run the tool-calling agent.",
  },
  {
    model: "openrouter:nvidia/nemotron-3.5-embed-1b:free",
    reason:
      "Embedding model that returns 2048 dims and fails (HTTP 500) when asked for 1536; the vector index needs exactly 1536, and only one embedding model can be active because vectors from different models are not comparable.",
  },
];

// Embeddings

/**
 * One embedding model only, vectors from different models live in different
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
 * Throws if the configured model fails, callers must not mix in local
 * vectors, which would corrupt similarity scores.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  if (!EMBEDDING_MODEL_ID) {
    return texts.map(embedTextLocally);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
  let embeddings: number[][];
  try {
    ({ embeddings } = await embedMany({
      model: providers.openrouter.embedding(EMBEDDING_MODEL_ID),
      values: texts.map((text) => text.slice(0, 8000) || " "),
      maxRetries: 2,
      abortSignal: controller.signal,
      providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } },
    }));
  } finally {
    clearTimeout(timer);
  }
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
 * Deterministic hashed 1536-dim vectors, the no-API fallback used when
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

// Configuration status

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
