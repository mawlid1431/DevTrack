/**
 * Starts the DevTrack voice worker (voice-agent/agent.py) with its own
 * virtualenv, on Windows or macOS/Linux. Used by `bun run dev:voice` and
 * `bun run dev`. First time: create the venv and install requirements:
 *   python -m venv voice-agent/.venv
 *   voice-agent/.venv/Scripts/python -m pip install -r voice-agent/requirements.txt   (Windows)
 *   voice-agent/.venv/bin/python -m pip install -r voice-agent/requirements.txt       (macOS/Linux)
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..", "voice-agent");
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

const child = Bun.spawn([python, "agent.py", "dev"], {
  cwd: dir,
  stdout: "inherit",
  stderr: "inherit",
});
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
process.exit(await child.exited);
