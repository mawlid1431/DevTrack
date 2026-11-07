/**
 * Push the server-side env vars the Convex backend needs from .env.local to
 * the Convex deployment, so secrets never have to be typed or pasted:
 *
 *   bun scripts/setup-convex-env.ts            # set everything that has a value
 *   bun scripts/setup-convex-env.ts --dry-run  # show what would be set
 *
 * Targets whatever the Convex CLI targets (CONVEX_DEPLOY_KEY or
 * CONVEX_DEPLOYMENT in .env.local). Values are never printed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CONVEX_VARS = [
  // Auth
  "CLERK_FRONTEND_API_URL",
  "CLERK_WEBHOOK_SECRET",
  // Lets the AI agent create new workspaces (Clerk organizations)
  "CLERK_SECRET_KEY",
  // AI providers
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  // AI models (see convex/agent/models.ts)
  "AI_MODEL_PROVIDER",
  "GROQ_MODEL_NAME",
  "AI_MODEL_NAME",
  "AI_FALLBACK_MODELS",
  "AI_EMBED_MODEL",
];

const dryRun = process.argv.includes("--dry-run");

const env = new Map<string, string>();
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (match) {
    env.set(match[1], match[2].replace(/^(['"])(.*)\1$/, "$2"));
  }
}

let failures = 0;
for (const name of CONVEX_VARS) {
  const value = env.get(name);
  if (!value) {
    console.log(`skip  ${name} (empty in .env.local)`);
    continue;
  }
  if (dryRun) {
    console.log(`would set ${name}`);
    continue;
  }
  // `bun x convex` via the running Bun binary — no shell, so values are
  // passed verbatim and Windows needs no npx.cmd shim.
  const proc = spawnSync(
    process.execPath,
    ["x", "convex", "env", "set", name, value],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }
  );
  if (proc.status === 0) {
    console.log(`set   ${name}`);
  } else {
    failures++;
    // Never echo the value: strip it from any CLI output before printing.
    const output = `${proc.stdout}${proc.stderr}`.split(value).join("<redacted>");
    console.log(`FAIL  ${name}: ${output.trim().split("\n").pop()}`);
  }
}

process.exit(failures > 0 ? 1 : 0);
