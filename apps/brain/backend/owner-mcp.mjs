// Local-owner extension. Upstream memory operations remain in the unmodified MCP server.
import { createInterface } from "node:readline";
import {
  readFileSync,
  existsSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { createMemoryServer } from "./vendor/keepmind/tools/keepmind-mcp.mjs";
const require = createRequire(import.meta.url);
const { SpaceKeys } = require("./vendor/keepmind/out/main/mcp-keys.js");
const {
  DerivedLearnings,
} = require("./vendor/keepmind/out/main/derived-learnings.js");
const state = resolve(process.env.KEEPMIND_MCP_STATE),
  root = resolve(process.env.KEEPMIND_MEMORY_DIR),
  keyFile = join(state, "security/memory-keys.json");
let keys;
const spaces = ["personal"];
if (process.env.KEEPMIND_MCP_UNLOCK_FD) {
  const fd = Number(process.env.KEEPMIND_MCP_UNLOCK_FD);
  if (fd < 3) throw new Error("Dedicated descriptor required");
  let credential = readFileSync(fd, "utf8");
  try {
    keys = await SpaceKeys.unlock(
      JSON.parse(readFileSync(keyFile, "utf8")),
      {
        put() {},
        get() {
          throw Error("Locked");
        },
        remove() {},
      },
      { passphrase: credential },
    );
  } finally {
    credential = "";
  }
}
function persistKeys() {
  const latest = JSON.parse(readFileSync(keyFile, "utf8"));
  if (latest.id !== keys.config.id) throw Error("Key configuration changed");
  for (const [space, key] of Object.entries(keys.config.spaces)) {
    if (latest.spaces[space] && latest.spaces[space] !== key)
      throw Error("Space changed; unlock again");
    latest.spaces[space] = key;
  }
  const tmp = keyFile + "." + randomUUID() + ".tmp";
  writeFileSync(tmp, JSON.stringify(latest), { mode: 0o600, flag: "wx" });
  renameSync(tmp, keyFile);
}
const upstream = createMemoryServer(root, {
  keys,
  state,
  clientId: "keepmind-ui",
  clients: {
    "keepmind-ui": {
      spaces,
      maxClass: "internal",
      write: true,
      owner: true,
      defaultSpace: "personal",
    },
  },
});
// Skills derived from abstract learnings live in the native general-knowledge space.
// This keeps the derived principle out of its source space (native anti-leak invariant).
const skillServer=createMemoryServer(root,{keys,clientId:'keepmind-skills',clients:{'keepmind-skills':{spaces:['general-knowledge'],maxClass:'internal',write:true,defaultSpace:'general-knowledge'}}});
const learning = () => {
  if (!keys) throw Error("Memória bloqueada");
  return new DerivedLearnings(
    root,
    state,
    keys,
    { owner: true, spaces, approval: true },
    persistKeys,
  );
};
const extra = [
  ["km_status", "Estado real do cofre"],
  ["km_learning_list", "Aprendizados privados do proprietário"],
  ["km_learning_propose", "Propor princípio derivado de evidência real"],
  ["km_learning_approve", "Aprovação exata pelo proprietário local"],
  ["km_learning_source", "Proveniência privada"],
  [
    "km_learning_suspend",
    "Marcar fonte incorreta e suspender aprendizados relacionados",
  ],
].map(([name, description]) => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      body: { type: "string" },
      purpose: { type: "string" },
      applicability: { type: "string" },
      id: { type: "string" },
      approvalDigest: { type: "string" },
      approved: { type: "boolean" },
    },
  },
}));
const reply = (id, data) => ({
  jsonrpc: "2.0",
  id,
  result: { content: [{ type: "text", text: JSON.stringify(data) }] },
});
function handle(msg) {
  try {
    if (msg.method === "tools/list") {
      const r = upstream(msg);
      r.result.tools.push(...extra);
      return r;
    }
    if (msg.method === "tools/call" && msg.params?.name?.startsWith("km_")) {
      const a = msg.params.arguments || {};
      let result;
      switch (msg.params.name) {
        case "km_status":
          result = {
            configured: existsSync(keyFile),
            unlocked: !!keys,
            encrypted: true,
            spaces,
            version: "0.2.6",
            transport: "stdio",
            ownerLearning: true,
          };
          break;
        case "km_learning_list":
          result = learning().list(undefined, true);
          break;
        case "km_learning_propose":
          result = learning().suggest(
            a.path,
            a.body,
            a.purpose,
            a.applicability,
          );
          break;
        case "km_learning_approve":
          if (a.approved !== true) throw Error("Revisão humana obrigatória");
          result = learning().promote(a.id, a.approvalDigest);
          break;
        case "km_learning_source":
          result = learning().sourceDetails(a.id);
          break;
        case "km_learning_suspend":
          result = learning().markSourceWrong(a.id);
          break;
        default:
          throw Error("Ferramenta desconhecida");
      }
      return reply(msg.id, result);
    }
    if (msg.method === "tools/call" && !keys)
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: "Memória bloqueada. Configure e desbloqueie as chaves nativas.",
            },
          ],
        },
      };
    if(msg.method==='tools/call'&&keys){
      const name=msg.params?.name,a=msg.params?.arguments||{};
      if(name==='sb_list'){
        const first=upstream(msg), second=skillServer(msg);
        if(second?.result?.isError)throw Error('Skill space unavailable');
        const left=(first.result?.content?.[0]?.text||'').split('\n').filter(p=>p.endsWith('.md'));
        const right=(second.result?.content?.[0]?.text||'').split('\n').filter(p=>p.startsWith('skills/')&&p.endsWith('.md'));
        first.result.content=[{type:'text',text:[...new Set([...left,...right])].join('\n')||'(empty)'}];return first;
      }
      if(name==='sb_read'&&String(a.path).startsWith('skills/')){const first=upstream(msg);if(!first.result?.content?.[0]?.text?.startsWith('not found:'))return first;return skillServer(msg)}
      if(name==='sb_write'&&String(a.path).startsWith('skills/')&&/^---\nspace: general-knowledge\n/.test(a.content||''))return skillServer(msg);
    }
    return upstream(msg);
  } catch (e) {
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: { isError: true, content: [{ type: "text", text: e.message }] },
    };
  }
}
process.on("exit", () => keys?.lock());
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const r = handle(JSON.parse(line));
    if (r) process.stdout.write(JSON.stringify(r) + "\n");
  } catch {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Invalid JSON" },
      }) + "\n",
    );
  }
}
