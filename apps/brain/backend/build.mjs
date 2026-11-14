import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "vendor/keepmind");
for (const [entry, name] of [
  ["services/security/keys.ts", "mcp-keys.js"],
  ["services/derived-learnings.ts", "derived-learnings.js"],
]) {
  const result = await Bun.build({
    entrypoints: [`${root}/src/main/${entry}`],
    outdir: `${root}/out/main`,
    naming: name,
    target: "node",
    format: "cjs",
    external: ["libsodium-wrappers-sumo"],
  });
  if (!result.success) throw new Error(result.logs.join("\n"));
}
