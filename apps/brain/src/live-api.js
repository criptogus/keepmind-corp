let token;
async function session() {
  const r = await fetch("/api/keepmind/session", {
    headers: { "X-Keepmind-UI": "1" },
  });
  if (!r.ok) throw Error("Ponte local indisponível");
  let data;try{data=await r.json()}catch{throw Error("Ponte local indisponível. Reinicie a conexão.")}
  token = data.token;
}
export async function api(path, body) {
  if (!token) await session();
  const opts = {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "X-Keepmind-UI": "1",
      "X-Keepmind-Session": token,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  let r = await fetch("/api/keepmind" + path, opts);
  if (r.status === 403) {
    await session();
    opts.headers["X-Keepmind-Session"] = token;
    r = await fetch("/api/keepmind" + path, opts);
  }
  let data;
  try {
    data = await r.json();
  } catch {
    throw Error("Ponte local indisponível. Verifique o serviço KeepMind.");
  }
  if (!r.ok) throw Error(data.error || "Operação recusada");
  return data;
}
