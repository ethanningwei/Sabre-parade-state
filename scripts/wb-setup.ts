// Drives /api/wb/setup on the deployment (or a tunnel to `next dev`):
//   npm run wb:setup -- status | webhook | menu | commands | evening | diff | claims
// Reads WB_WEBHOOK_SECRET and WB_APP_URL from the environment or .env.local.
// The bot token stays on the server; this script never sees it.
import { existsSync, readFileSync } from "node:fs";

const env: Record<string, string> = {};
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const secret = process.env.WB_WEBHOOK_SECRET ?? env.WB_WEBHOOK_SECRET;
const base = (process.env.WB_APP_URL ?? env.WB_APP_URL ?? "").replace(/\/+$/, "");
const action = process.argv[2] ?? "status";

if (!secret || !base) {
  console.error("WB_WEBHOOK_SECRET and WB_APP_URL must be set in the environment or .env.local");
  process.exit(1);
}

fetch(`${base}/api/wb/setup?action=${encodeURIComponent(action)}`, {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
})
  .then(async (res) => {
    const body = await res.text();
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      console.log(res.status, body.slice(0, 500));
    }
    if (!res.ok) process.exit(1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
