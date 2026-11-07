import { generateText, jsonSchema, stepCountIs, tool } from "ai";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  EXCLUDED_MODELS,
  FAILURE_REASONS,
  chatModel,
  chatModelChain,
  classifyAiError,
  coolingModels,
  embedTexts,
  userFacingAiError,
} from "./models";

/**
 * Health check for every AI model, run against the live providers with the
 * deployment's own env vars:
 *
 *   npx convex run agent/diagnostics:checkModels
 *
 * - Every chat model is tested IN PARALLEL and must answer AND call a tool
 *   (the agent depends on tool calling). Failures get a classified status and
 *   a plain-language reason.
 * - `failover` sends one request through the real resilient chain the agent
 *   uses and reports which model actually answered.
 * - `excluded` lists models from the configured list that are deliberately
 *   not used, with the verified reason.
 */

const statusValidator = v.union(
  v.literal("ready"),
  v.literal("no_tool_call"),
  v.literal("rate_limited"),
  v.literal("auth"),
  v.literal("not_found"),
  v.literal("unsupported"),
  v.literal("server_error"),
  v.literal("timeout"),
  v.literal("network"),
  v.literal("unknown")
);

const listTeams = tool({
  description: "List the teams in the workspace",
  inputSchema: jsonSchema<Record<string, never>>({
    type: "object",
    properties: {},
    additionalProperties: false,
  }),
  execute: async () => [{ key: "ENG", name: "Engineering" }],
});

const PROMPT = "Call the listTeams tool, then reply with the team names.";

export const checkModels = internalAction({
  args: {},
  returns: v.object({
    ready: v.boolean(),
    summary: v.string(),
    chat: v.array(
      v.object({
        position: v.number(),
        model: v.string(),
        status: statusValidator,
        ms: v.number(),
        reason: v.string(),
      })
    ),
    failover: v.object({
      ok: v.boolean(),
      answeredBy: v.string(),
      ms: v.number(),
      detail: v.string(),
    }),
    embedding: v.object({
      model: v.string(),
      ok: v.boolean(),
      detail: v.string(),
    }),
    excluded: v.array(v.object({ model: v.string(), reason: v.string() })),
    coolingDown: v.array(
      v.object({ model: v.string(), kind: v.string(), secondsLeft: v.number() })
    ),
  }),
  handler: async () => {
    // 1. Every chat model, in parallel, bypassing failover.
    const chat = await Promise.all(
      chatModelChain.map(async (entry, index) => {
        const started = Date.now();
        const model = `${entry.provider}:${entry.modelId}`;
        try {
          const result = await generateText({
            model: entry.model,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(45_000),
            prompt: PROMPT,
            tools: { listTeams },
            stopWhen: stepCountIs(3),
          });
          const called = result.steps.some((s) => s.toolCalls.length > 0);
          return {
            position: index + 1,
            model,
            status: called ? ("ready" as const) : ("no_tool_call" as const),
            ms: Date.now() - started,
            reason: called
              ? `Answered with a tool call: ${result.text.slice(0, 80).replace(/\s+/g, " ")}`
              : "Answered but did not call the tool: cannot drive the agent's tools.",
          };
        } catch (error) {
          const failure = classifyAiError(error);
          return {
            position: index + 1,
            model,
            status: failure.kind,
            ms: Date.now() - started,
            reason: `${FAILURE_REASONS[failure.kind]} Provider said: ${failure.message.slice(0, 160)}`,
          };
        }
      })
    );

    // 2. One request through the real resilient chain (parallel race + failover).
    const failoverStarted = Date.now();
    let failover;
    try {
      const result = await generateText({
        model: chatModel,
        prompt: PROMPT,
        tools: { listTeams },
        stopWhen: stepCountIs(3),
      });
      failover = {
        ok: true,
        answeredBy: result.response.modelId,
        ms: Date.now() - failoverStarted,
        detail: result.text.slice(0, 120).replace(/\s+/g, " "),
      };
    } catch (error) {
      failover = {
        ok: false,
        answeredBy: "none",
        ms: Date.now() - failoverStarted,
        detail: userFacingAiError(error),
      };
    }

    // 3. Embedding model.
    let embedding;
    const embedModel = EMBEDDING_MODEL_ID ?? "local hashed embeddings";
    try {
      const [a, b, c] = await embedTexts([
        "Login button broken on Safari",
        "Safari login fails after clicking sign in",
        "Database migration for invoices table",
      ]);
      const cos = (x: number[], y: number[]) =>
        x.reduce((sum, value, i) => sum + value * y[i], 0);
      const similar = cos(a, b);
      const unrelated = cos(a, c);
      embedding = {
        model: embedModel,
        ok: a.length === EMBEDDING_DIMENSIONS && similar > unrelated,
        detail: `dims=${a.length} similar=${similar.toFixed(2)} unrelated=${unrelated.toFixed(2)}`,
      };
    } catch (error) {
      const failure = classifyAiError(error);
      embedding = {
        model: embedModel,
        ok: false,
        detail: `${FAILURE_REASONS[failure.kind]} Provider said: ${failure.message.slice(0, 160)}`,
      };
    }

    const readyCount = chat.filter((c) => c.status === "ready").length;
    const ready = failover.ok && embedding.ok && readyCount > 0;
    return {
      ready,
      summary: `${readyCount}/${chat.length} chat models ready; failover answered by ${failover.answeredBy}; embeddings ${embedding.ok ? "ok" : "FAILING"}; ${EXCLUDED_MODELS.length} models excluded by design.`,
      chat,
      failover,
      embedding,
      excluded: EXCLUDED_MODELS,
      coolingDown: coolingModels(),
    };
  },
});
