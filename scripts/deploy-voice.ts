/**
 * Deploy the DevTrack voice worker (voice-agent/) to LiveKit Cloud so voice
 * calls work on every device, all the time, without a PC running it.
 *
 *   bun run deploy:voice
 *
 * First run: `lk agent create` (writes voice-agent/livekit.toml).
 * Later runs: updates the secrets, then `lk agent deploy`.
 * Secrets come from .env.local into a temporary file that is deleted again;
 * they are never printed or baked into the image.
 * Needs the LiveKit CLI (`lk`), signed in: `lk cloud auth`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const agentDir = join(root, "voice-agent");
const project = process.env.LIVEKIT_PROJECT ?? "devtrack";
// Closest LiveKit Cloud region to the project (the "devtrack" project is in the United States): us-east, me-central, eu-central, ap-south.
const region = process.env.LIVEKIT_REGION ?? "us-east";

const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    })
);

const secrets: Record<string, string | undefined> = {
  AGENT_SHARED_SECRET: env.AGENT_SHARED_SECRET,
  NEXT_PUBLIC_CONVEX_SITE_URL: env.NEXT_PUBLIC_CONVEX_SITE_URL,
  DEVTRACK_VOICE_AGENT_NAME: "devtrack-voice",
};
const missing = Object.entries(secrets).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(", ")}`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "devtrack-voice-"));
const secretsFile = join(dir, "secrets.env");
writeFileSync(secretsFile, Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");

const lk = (args: string[]) => {
  console.log(`> lk ${args.join(" ").replace(secretsFile, "<secrets file>")}`);
  const r = spawnSync("lk", args, { cwd: agentDir, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`lk ${args[0]} ${args[1]} failed`);
};

try {
  if (!existsSync(join(agentDir, "livekit.toml"))) {
    lk(["agent", "create", "--project", project, "--region", region, "--secrets-file", secretsFile, "."]);
  } else {
    lk(["agent", "update-secrets", "--secrets-file", secretsFile, "--overwrite"]);
    lk(["agent", "deploy", "."]);
  }
  console.log("\nVoice worker deployed to LiveKit Cloud. Check it with: cd voice-agent && lk agent status");
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
