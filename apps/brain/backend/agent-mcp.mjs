// Ephemeral, read-only MCP relay for one Codex execution. No keys or passphrases.
import { createInterface } from "node:readline";
for await (const line of createInterface({ input: process.stdin })) {
  let msg;
  try {
    msg = JSON.parse(line);
    if (msg.id === undefined) continue;
    const r = await fetch(process.env.KEEPMIND_BRIDGE_URL + "/internal/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.KEEPMIND_JOB_TOKEN,
      },
      body: JSON.stringify(msg),
    });
    if (!r.ok) throw Error("Access unavailable");
    process.stdout.write(JSON.stringify(await r.json()) + "\n");
  } catch {
    if (msg?.id !== undefined)
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32000, message: "Scoped memory unavailable" },
        }) + "\n",
      );
  }
}
