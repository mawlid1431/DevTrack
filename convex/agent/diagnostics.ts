import { generateText, jsonSchema, stepCountIs, tool } from "ai";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  chatModelChain,
  embedTexts,
} from "./models";

/**
 * Health check for every configured AI model, run against the live providers
 * with the deployment's own env vars:
 *
 *   npx convex run agent/diagnostics:checkModels
 *
 * Each chat model must answer AND call a tool (the agent depends on tool
 * calling). The embedding model must return 1536-dim vectors that score a
 * near-duplicate pair well above an unrelated pair.
 */
export const checkModels = internalAction({
  args: {},
  returns: v.object({
    chat: v.array(
      v.object({
        model: v.string(),
        ok: v.boolean(),
        toolCalled: v.boolean(),
        ms: v.number(),
        detail: v.string(),
      })
    ),
    embedding: v.object({
      model: v.string(),
      ok: v.boolean(),
      detail: v.string(),
    }),
  }),
  handler: async () => {
    const chat = [];
    for (const entry of chatModelChain) {
      const started = Date.now();
      let toolCalled = false;
      try {
        const result = await generateText({
          model: entry.model,
          maxRetries: 0,
          prompt: "Call the listTeams tool, then reply with the team names.",
          tools: {
            listTeams: tool({
              description: "List the teams in the workspace",
              inputSchema: jsonSchema<Record<string, never>>({
                type: "object",
                properties: {},
                additionalProperties: false,
              }),
              execute: async () => {
                toolCalled = true;
                return [{ key: "ENG", name: "Engineering" }];
              },
            }),
          },
          stopWhen: stepCountIs(3),
        });
        chat.push({
          model: `${entry.provider}:${entry.modelId}`,
          ok: toolCalled,
          toolCalled,
          ms: Date.now() - started,
          detail: toolCalled
            ? result.text.slice(0, 120)
            : "Answered without calling the tool — not usable for the agent",
        });
      } catch (error) {
        chat.push({
          model: `${entry.provider}:${entry.modelId}`,
          ok: false,
          toolCalled,
          ms: Date.now() - started,
          detail: error instanceof Error ? error.message.slice(0, 200) : String(error),
        });
      }
    }

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
      embedding = {
        model: embedModel,
        ok: false,
        detail: error instanceof Error ? error.message.slice(0, 200) : String(error),
      };
    }

    return { chat, embedding };
  },
});
