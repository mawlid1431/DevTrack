/**
 * Starts the DevTrack voice worker (voice-agent/agent.py) with its own
 * virtualenv, on Windows or macOS/Linux. Used by `bun run dev:voice` and
 * `bun run dev` (run from the project root). First-time setup:
 *   python -m venv voice-agent/.venv
 *   then install voice-agent/requirements.txt with that venv's python -m pip
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "voice-agent");
const python =
  process.platform === "win32"
    ? join(dir, ".venv", "Scripts", "python.exe")
    : join(dir, ".venv", "bin", "python");

if (!existsSync(python)) {
  console.warn(
    "[voice] voice-agent/.venv not found, so voice calls are off. See scripts/voice-agent.ts to set it up."
  );
  process.exit(0);
}

const child = spawn(python, ["agent.py", "dev"], { cwd: dir, stdio: "inherit" });
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
