import os from "os";

function getLanIp(): string | null {
  const candidates: Array<{ address: string; score: number }> = [];

  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    if (!ifaces) continue;

    const lower = name.toLowerCase();
    for (const iface of ifaces) {
      if (iface.family !== "IPv4" || iface.internal) continue;

      const { address } = iface;
      if (
        !address.startsWith("192.168.") &&
        !address.startsWith("10.") &&
        !/^172\.(1[6-9]|2\d|3[01])\./.test(address)
      ) {
        continue;
      }

      let score = 0;
      if (lower.includes("wi-fi") || lower.includes("wifi") || lower.includes("wlan")) {
        score += 10;
      }
      if (lower.includes("ethernet") && !name.includes("*")) {
        score += 8;
      }
      if (address.startsWith("192.168.137.")) {
        score -= 5;
      }
      if (name.includes("*")) {
        score -= 3;
      }

      candidates.push({ address, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address ?? null;
}

const port = process.env.PORT ?? "3000";
const ip = getLanIp();

console.log("");
console.log("  DevTrack on your network");
console.log("  ─────────────────────────");
console.log(`  Local:    http://localhost:${port}`);
if (ip) {
  console.log(`  Network:  http://${ip}:${port}`);
} else {
  console.log("  Network:  (could not detect — run ipconfig)");
}
console.log("");
