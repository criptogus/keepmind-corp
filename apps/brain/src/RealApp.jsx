import {loadLiveData} from './live-refresh';
import ProposalExecution from "./ProposalExecution";
import QuickProposal from "./QuickProposal";
import SkillsLibrary from "./SkillsLibrary";
import RealHealth from "./RealHealth";
import CycleSettings from "./CycleSettings";
import React, { useState, useEffect, useRef } from "react";
import {
  Sun,
  Stack,
  ChatCircle,
  Gear,
  Plus,
  MagnifyingGlass,
  ArrowRight,
  FileText,
  CheckCircle,
  Lock,
  Plugs,
  Lightning,
  X,
  Pause,
  Play,
} from "@phosphor-icons/react";
import { api } from "./live-api";
import { attentionDeliveries } from "./deliveries";
const configTabs = [
  "Conexão",
  "Skills",
  "Rotinas",
  "Segurança",
  "Saúde",
  "Modelos",
  "Avançado",
];
export default function RealApp() {
  const [page, setPage] = useState(location.hash.slice(1) || "hoje"),
    [tab, setTab] = useState(configTabs.includes(new URLSearchParams(location.search).get("tab")) ? new URLSearchParams(location.search).get("tab") : "Conexão"),
    [memoryView, setMemoryView] = useState("Notas"),
    [status, setStatus] = useState(null),
    [notes, setNotes] = useState([]),
    [learnings, setLearnings] = useState([]),
    [skills, setSkills] = useState([]),
    [skillsError,setSkillsError] = useState(false),
    [skillsLoaded,setSkillsLoaded] = useState(false),
    [jobs, setJobs] = useState([]),
    [executions,setExecutions] = useState([]),
    [today, setToday] = useState(null),
    [metric, setMetric] = useState(null),
    [jobId, setJobId] = useState(null),
    [selected, setSelected] = useState([]),
    [query, setQuery] = useState(""),
    [goal, setGoal] = useState(""),
    [error, setError] = useState(""),
    [refreshError,setRefreshError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState(null),
    [password, setPassword] = useState(""),
    [editor, setEditor] = useState(null),
    [learningDraft, setLearningDraft] = useState(null),
    [proposal, setProposal] = useState(null),
    [skillDraft, setSkillDraft] = useState(null),
    [searchResult, setSearchResult] = useState(null),
    [undoDecision, setUndoDecision] = useState(null);
  const job = jobs.find((j) => j.id === jobId) || jobs[0];
  const live = !!status?.unlocked;
  const featured = today?.autonomy?.insight;
  const featuredJob = jobs.find(j => j.id === featured?.id);
  const recentDeliveries = attentionDeliveries({jobs, learnings, skills, featuredId: featured?.id});
  const mounted = useRef(true);
  const go = (p) => {
    setPage(p);
    location.hash = p;
    setError("");
  };
  useEffect(() => {
    const fn = () => setPage(location.hash.slice(1) || "hoje");
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  const refreshing = useRef(null);
  async function refresh() {
    if(refreshing.current)return refreshing.current;
    const run=()=>loadLiveData(api,{mounted,setStatus,setToday,setNotes,setLearnings,setSkills,setJobs,setExecutions,setSkillsError,setSkillsLoaded,setError:setRefreshError});
    refreshing.current=run().finally(()=>{refreshing.current=null});
    return refreshing.current;
  }
  useEffect(() => {
    mounted.current = true;
    refresh().catch((e) => setRefreshError(e.message));
    const timer = setInterval(
      () =>
        refresh().catch((e) => {
          setStatus(null);
          setRefreshError(e.message);
        }),
      5000,
    );
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);
  async function act(fn) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function decideProposal(id, status) {
    await act(async()=>{
      if(status==='accepted'){
        const execution=await api('/proposal/execute',{id});
        setExecutions(rows=>[...rows.filter(r=>r.id!==execution.id),execution]);
        setUndoDecision(null);setMessage(execution.status==='blocked'?execution.message:'Execução iniciada. O resultado aparecerá aqui.');
        await refresh();return;
      }
      const saved=await api('/proposal/decision',{id,status});
      setUndoDecision(status==='open'?null:{id,status:saved.previous});
      setMessage(status==='accepted'?'Proposta aceita e guardada no histórico; nenhuma alteração foi executada.':status==='resolved'?'Proposta marcada como resolvida.':status==='dismissed'?'Proposta dispensada.':'Proposta reaberta.');
      await refresh();
    });
  }

  async function undoExecution(id){
    await act(async()=>{const row=await api('/proposal/undo',{id});setMessage(row.status==='undone'?'Melhoria desfeita; conteúdo anterior restaurado.':row.message);await refresh()});
  }

  async function openNote(path) {
    await act(async () => {
      setEditor(await api("/note?path=" + encodeURIComponent(path)));
      setModal("note");
    });
  }
  async function launch(skill) {
    if (!selected.length) {
      setError(
        "Selecione as fontes na Memória ou no painel de contexto antes de iniciar.",
      );
      go("assistente");
      setError("Selecione ao menos uma fonte para o Codex consultar.");
      return;
    }
    await act(async () => {
      const j = await api("/jobs", {
        goal:
          goal.trim() ||
          skill?.metadata?.name ||
          "Revisar e melhorar a memória com evidências",
        paths: selected,
        skillPath: skill?.path,
      });
      setJobs((js) => [j, ...js]);
      setJobId(j.id);
      setLearningDraft(null);
      setProposal(null);
      setSkillDraft(null);
      go("assistente");
    });
  }
  async function lock() {
    await act(async () => {
      await api("/lock", {});
      setEditor(null);
      setLearningDraft(null);
      setProposal(null);
      setSkillDraft(null);
      setModal(null);
      setPassword("");
      await refresh();
    });
  }
  useEffect(() => {
    if (!modal) return;
    const prev = document.activeElement;
    const dialog = document.querySelector("[role=dialog]");
    const elems = () => [
      ...dialog.querySelectorAll("button:not(:disabled),input,textarea,select"),
    ];
    elems()[0]?.focus();
    const trap = (e) => {
      if (e.key === "Escape") setModal(null);
      if (e.key === "Tab") {
        const es = elems();
        if (e.shiftKey && document.activeElement === es[0]) {
          e.preventDefault();
          es.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === es.at(-1)) {
          e.preventDefault();
          es[0]?.focus();
        }
      }
    };
    dialog.addEventListener("keydown", trap);
    return () => {
      dialog.removeEventListener("keydown", trap);
      prev?.focus();
    };
  }, [modal]);
  const filtered = notes.filter((n) =>
    (n.title + " " + n.path).toLowerCase().includes(query.toLowerCase()),
  );
  const connection = (
    <section className="panel connectionpanel">
      <div>
        <span className="eyebrow">
          {status ? "BACKEND REAL · MCP STDIO" : "CONEXÃO LOCAL"}
        </span>
        <h2>
          {!status
            ? "Conectando ao KeepMind…"
            : !status.configured
              ? "Configure o cofre no KeepMind nativo"
              : !live
                ? "Desbloqueie sua memória"
                : "Memória real conectada"}
        </h2>
        <p>
          {!status
            ? "Aguardando a ponte local. Nenhum dado de demonstração será usado."
            : !status.configured
              ? "As chaves nativas ainda não foram configuradas. Abra o KeepMind e configure a criptografia da memória. Depois, atualize o estado aqui."
              : !live
                ? "O servidor está conectado, mas não pode ler ou gravar sem desbloquear as chaves."
                : status.mode === "shared-markdown" ? "Seu acervo Markdown existente, sem migração de criptografia. Novos registros ficam em KeepMind-Bridge; fontes existentes permanecem intactas." : "Leitura e escrita criptografadas pelo servidor MCP do KeepMind. Codex usa somente as fontes autorizadas."}
        </p>
        <small>
          Escopo: {status?.scope || "Aguardando conexão"}.
        </small>
      </div>
      <div className="actions">
        {status?.configured && !live && (
          <button className="primary" onClick={() => setModal("unlock")}>
            Desbloquear cofre
          </button>
        )}
        {live && status?.mode !== "shared-markdown" && (
          <button onClick={lock} disabled={busy}>
            <Lock />
            Bloquear conexão
          </button>
        )}
        <button disabled={busy} onClick={() => act(refresh)}>
          Atualizar estado
        </button>
      </div>
    </section>
  );
  return (
    <div className={"shell" + (new URLSearchParams(location.search).has("embed") ? " embedded" : "")}>
      <aside>
        <div className="brand">
          <img src={import.meta.env.BASE_URL+"assets/keepmind.png"} alt="" />
          <div>
            <b>
              KEEP<span>MIND</span>
            </b>
            <small>Seu segundo cérebro</small>
          </div>
        </div>
        <button
          className="primary"
          disabled={!live}
          onClick={() => {
            setEditor({
              path: "notes/" + crypto.randomUUID() + ".md",
              body: "",
              create: true,
            });
            setModal("note");
          }}
        >
          <Plus />
          Guardar
        </button>
        <nav>
          {[
            ["hoje", "Hoje", Sun],
            ["memoria", "Memória", Stack],
            ["assistente", "Assistente", ChatCircle],
          ].map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "selected" : ""}
              onClick={() => go(id)}
            >
              <Icon size={23} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebottom">
          <button
            className={page === "configuracoes" ? "selected" : ""}
            onClick={() => go("configuracoes")}
          >
            <Gear size={23} />
            Configurações
          </button>
          <div className="status">
            <span className={"dot " + (!live ? "amber" : "")} />
            {live ? "Memória conectada" : "Memória indisponível"}
            <button
              className="textlink"
              onClick={() => {
                setTab("Conexão");
                go("configuracoes");
              }}
            >
              Codex via MCP
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header>
          {new URLSearchParams(location.search).has("embed") && page !== "hoje" && <button onClick={() => go("hoje")}>← Hoje</button>}
          <label className="search">
            <MagnifyingGlass />
            <input
              aria-label="Buscar na memória"
              placeholder="Buscar na memória real"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                go("memoria");
              }}
            />
          </label>
          <span className="demobadge">
            BACKEND REAL · {status ? "MCP" : "OFFLINE"}
          </span>
          <button
            className="primary mobilecapture"
            disabled={!live}
            onClick={() => {
              setEditor({
                path: "notes/" + crypto.randomUUID() + ".md",
                body: "",
                create: true,
              });
              setModal("note");
            }}
          >
            <Plus />
            Guardar
          </button>
        </header>
        {(error || refreshError) && (
          <div className="notice live-error" role="alert">
            {error || refreshError}
            <button aria-label="Fechar erro" onClick={() => {setError("");setRefreshError("")}}>
              <X />
            </button>
          </div>
        )}
        {message && (
          <div className="notice" role="status">
            {message}
            {undoDecision && <button disabled={busy} onClick={()=>decideProposal(undoDecision.id,undoDecision.status)}>Desfazer</button>}
          </div>
        )}
        {metric && <section className="panel" role="region" aria-label="Evidências da métrica">
          <button onClick={()=>setMetric(null)}>Fechar evidências</button><h2>{metric.label}</h2><p>{metric.detail}</p>
          <p>{today?.window}. Indicadores técnicos da ponte. Resultados externos ficam em Valor observado.</p>
          {metric.evidence.length===0?<p>Nenhuma execução disponível para este indicador.</p>:metric.evidence.map(id=>{const j=jobs.find(x=>x.id===id);return <button className="noterow" key={id} onClick={()=>{setJobId(id);setMetric(null);go('assistente')}}>{j?.goal||id} · {j?.status}<ArrowRight/></button>})}
        </section>}
        {page === "hoje" && (
          <div className="today-focus">
            <div className="heading"><h1>Hoje</h1><span className="caption">{live ? "Memória conectada" : "Memória indisponível"}</span></div>
            {!live && connection}
            <div className="today-section-head"><span className="caption">{today?.autonomy?.status==='running'?'Analisando sua memória…':today?.autonomy?.enabled?'Análise automática diária':'Análise automática pausada'}</span><button className="textlink" onClick={()=>act(async()=>{await api('/autonomy',{enabled:!today?.autonomy?.enabled});await refresh()})}>{today?.autonomy?.enabled?'Pausar':'Ativar'}</button></div>
            {learnings.some(l=>l.status==='pending') && <section className="panel today-decision"><h2>{learnings.filter(l=>l.status==='pending').length} aprendizados para revisar</h2><button className="primary" onClick={()=>{setMemoryView('Aprendizados');go('memoria')}}>Revisar<ArrowRight/></button></section>}
            <section className="panel">
              <h2>O que merece sua atenção</h2>
              {today?.autonomy?.insight ? <QuickProposal result={featuredJob?.result||{summary:featured.summary}} busy={busy||!featuredJob} decide={status=>decideProposal(featured.id,status)}>
                <p>{featured.summary}</p><small>{new Date(featured.at).toLocaleString('pt-BR')} · amostra da memória</small>
                {featured.sources.map(path=><button className="noterow" key={path} onClick={()=>openNote(path)}>{path}<ArrowRight/></button>)}
                <button onClick={()=>{setJobId(featured.id);go('assistente')}}>Abrir análise completa</button>
              </QuickProposal>:<p>{today?.autonomy?.status==='running'?'Seu cérebro está buscando conexões e melhorias. Você não precisa preparar nada.':today?.autonomy?.noNews?'Nenhuma proposta pendente nesta análise.':today?.autonomy?.error?'A análise precisa de atenção. Veja o estado abaixo.':'Preparando a primeira análise da memória.'}</p>}
              {today?.autonomy?.error && <details><summary>Estado da análise</summary><p>{today.autonomy.error}</p></details>}
            </section>
            {executions.length>0&&<details className="panel today-secondary"><summary>Histórico de melhorias</summary>{[...executions].reverse().slice(0,3).map(row=><ProposalExecution key={row.id} row={row} busy={busy} undo={undoExecution} retry={decideProposal}/>)}</details>}
            <p className="caption today-accept-note">Aceitar aplica onde permitido; fontes protegidas recebem uma proposta revisável.</p>
            <section className="panel today-results"><div className="today-section-head"><h2>Últimas entregas</h2><button className="textlink" onClick={()=>go('assistente')}>Histórico</button></div>
              {recentDeliveries.map(j=><QuickProposal key={j.id} result={j.result} busy={busy} decide={status=>decideProposal(j.id,status)}>
                <p>{j.result.summary}</p>
                {(j.result.sourcePaths||[]).map(path=><button className="noterow" key={path} onClick={()=>openNote(path)}>{path}<ArrowRight/></button>)}
                <button onClick={()=>{setJobId(j.id);go('assistente')}}>Abrir análise completa</button>
              </QuickProposal>)}
              {!recentDeliveries.length && <p className="caption">Nada novo para revisar.</p>}
            </section>
            <details className="panel today-secondary"><summary>Valor observado · {today?.value?.tasks||0} tarefas registradas</summary>
              <p className="caption">{today?.value?.tasks?'Resultados relatados pelos agentes; ainda sem ganho comprovado.':'Ainda sem resultados de tarefas reais registrados via MCP.'}</p>
              <p className="caption">{today?.value?.contextUsed||0} tarefas com uso declarado de contexto · {today?.value?.comparisons?.length||0} comparações pareadas</p>
              {today?.value?.comparisons?.map(pair=><details key={pair.candidateId}><summary>{pair.task}</summary><p className="caption">GitHub → KeepMind. Mesmos agente, modelo e identificador de comparação; não prova causalidade.</p><p>Correções: {pair.baseline.corrections??'—'} → {pair.candidate.corrections??'—'} · Resultado: {pair.outcomes.join(' → ')}</p></details>)}
              {today?.value?.records?.map(r=><button className="noterow" key={r.id} onClick={()=>openNote(r.path)}>{r.agent}: {r.task}<ArrowRight/></button>)}
            </details>
            <details className="panel today-secondary"><summary>Atividade e acervo</summary><p className="caption">Análise diária via Codex · até 6 fontes por rodada · usa sua cota · alterações exigem revisão. {today?.autonomy?.background ? "Serviço automático do Mac ativo; não é necessário abrir o app." : "Funciona enquanto a ponte local estiver ativa."}</p>
              <p className="caption">{today?.window||'Telemetria indisponível'}</p>
              <div className="today-metrics">{(today?.metrics||[]).map(m=><button className="today-metric" key={m.label} onClick={()=>setMetric(m)}><strong>{m.value??'—'}</strong><span>{m.label}</span></button>)}</div>
              {today?.inventory && <p className="caption">{today.inventory.notes} notas · {today.inventory.activeLearnings} aprendizados · {today.inventory.skills} skills</p>}
              <div className="actions"><button onClick={()=>go('memoria')}>Memória</button><button onClick={()=>{setMemoryView('Aprendizados');go('memoria')}}>Aprendizados</button><button onClick={()=>{setTab('Skills');go('configuracoes')}}>Skills</button><button onClick={()=>act(refresh)}>Atualizar</button></div>
              <details><summary>Conexão</summary>{connection}</details>
            </details>
          </div>
        )}
        {page === "memoria" && (
          <>
            <div className="heading">
              <span className="eyebrow">MEMÓRIA</span>
              <h1>Fontes reais. Aprendizado verificável.</h1>
              <p>Dados do acervo conectado, sem copiar exemplos do protótipo.</p>
            </div>
            <div className="toolbar">
              <div className="segmented">
                {["Notas", "Aprendizados", "Meu contexto"].map((v) => (
                  <button
                    className={memoryView === v ? "active" : ""}
                    key={v}
                    onClick={() => setMemoryView(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <button
                disabled={!live || !query.trim()}
                onClick={() =>
                  act(async () =>
                    setSearchResult((await api("/search", { query })).text),
                  )
                }
              >
                Buscar conteúdo via MCP
              </button>
            </div>
            {!live ? (
              connection
            ) : memoryView === "Notas" ? (
              <>
                <section className="panel library">
                  {filtered.map((n) => (
                    <div className="noterow" key={n.path}>
                      <input
                        type="checkbox"
                        aria-label={"Usar " + n.title}
                        checked={selected.includes(n.path)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, n.path]
                              : selected.filter((p) => p !== n.path),
                          )
                        }
                      />
                      <button
                        className="textlink"
                        onClick={() => openNote(n.path)}
                      >
                        <FileText />
                        <span>{n.title}</span>
                      </button>
                      <small>{n.path}</small>
                    </div>
                  ))}
                  {!filtered.length && (
                    <p>Nenhuma nota disponível para esse filtro.</p>
                  )}
                </section>
                <div className="actions">
                  <span>{selected.length} fontes selecionadas</span>
                  <button onClick={() => go("assistente")}>
                    Usar no Codex
                  </button>
                </div>
                {searchResult && <pre className="panel">{searchResult}</pre>}
              </>
            ) : memoryView === "Meu contexto" ? (
              <section className="panel">
                <h2>Contexto compartilhado por seus agentes</h2>
                <p>
                  Edite uma nota do acervo com preferências, objetivos e
                  critérios. Selecione essa nota como fonte para incluí-la nas
                  tarefas do Codex.
                </p>
                <button
                  onClick={() =>
                    act(async () => {
                      const path = "long-term/ui-profile.md";
                      const exists = notes.some((n) => n.path === path);
                      setEditor(
                        exists
                          ? await api("/note?path=" + encodeURIComponent(path))
                          : {
                              path,
                              body: "# Meu contexto\n\n## Objetivos\n\n## Critérios de decisão\n\n## Estilo\n",
                              create: true,
                            },
                      );
                      setModal("note");
                    })
                  }
                >
                  Editar meu contexto real
                </button>
              </section>
            ) : (
              <section className="panel">
                <h2>Aprendizados derivados</h2>
                <p>
                  O serviço verifica a evidência e exige aprovação da
                  revisão exata. Mudanças nas fontes podem impedir a promoção.
                </p>
                {learnings.map((l) => (
                  <article className="routinecard" key={l.id}>
                    <span className="tag">{l.status}</span>
                    <h3>{l.purpose}</h3>
                    <p>{l.body}</p>
                    <p className="caption">Aplicabilidade: {l.applicability}</p>
                    <div className="actions">
                      <button
                        onClick={() =>
                          act(async () => {
                            const source = await api(
                              "/learning/source?id=" + encodeURIComponent(l.id),
                            );
                            setEditor(
                              await api(
                                "/note?path=" + encodeURIComponent(source.path),
                              ),
                            );
                            setModal("note");
                          })
                        }
                      >
                        Ver fonte
                      </button>
                      <button
                        onClick={() => {
                          setProposal(null);
                          setLearningDraft({
                            id: l.id,
                            body: l.body,
                            purpose: l.purpose,
                            applicability: l.applicability,
                            sourcePath: "",
                          });
                          go("assistente");
                        }}
                      >
                        Preparar nova revisão
                      </button>
                      {l.status === "active" && (
                        <button
                          onClick={() => {
                            setSkillDraft({
                              learningId: l.id,
                              name: l.purpose,
                              steps: l.body,
                              checks: "Confirmar fontes\nRevisar alterações",
                            });
                            go("assistente");
                          }}
                        >
                          Criar skill
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {!learnings.length && (
                  <p>Nenhum aprendizado visível neste escopo.</p>
                )}
              </section>
            )}
          </>
        )}
        {page === "assistente" && (
          <>
            <label className="field">Histórico de execuções
              <select aria-label="Histórico de execuções" value={job?.id||''} onChange={e=>{setJobId(e.target.value);setLearningDraft(null);setProposal(null);setSkillDraft(null)}}>
                {!jobs.length && <option value="">Nenhuma execução</option>}
                {[...jobs].reverse().map(j=><option key={j.id} value={j.id}>{new Date(j.startedAt).toLocaleString('pt-BR')} · {j.result?.skill?.name||'Execução do Codex'}{j.proposalDecision ? ' · '+(j.proposalDecision.status==='accepted'?'Aceita para execução':j.proposalDecision.status==='resolved'?'Resolvida':'Dispensada'):''}</option>)}
              </select>
            </label>
            <div className="heading">
              <span className="eyebrow">CODEX · MCP</span>
              <h1>Seu LLM trabalha. Seu cérebro evolui.</h1>
              <p>
                Objetivo, execução, resultado, aprendizado e skill — ligados ao
                backend real.
              </p>
            </div>
            {!live ? (
              connection
            ) : (
              <>
                <ol className="cycle">
                  {[
                    "Objetivo",
                    "Execução",
                    "Resultado",
                    "Aprendizado",
                    "Skill",
                  ].map((s, i) => (
                    <li
                      key={s}
                      className={
                        job?.status === "done" || i === 0 ? "reached" : ""
                      }
                    >
                      <span>{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ol>
                <div className="assistantlayout">
                  <section className="panel conversation">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        launch();
                      }}
                    >
                      <label className="field">
                        Objetivo
                        <input
                          value={goal}
                          onChange={(e) => setGoal(e.target.value)}
                          placeholder="Que melhoria você quer investigar?"
                        />
                      </label>
                      <button
                        className="primary"
                        disabled={
                          busy || job?.status === "running" || !selected.length
                        }
                        type="submit"
                      >
                        Executar no Codex
                      </button>
                    </form>
                    <p className="caption">
                      Não executa tarefas sem sua solicitação. Usa seu login e
                      modelo configurado no Codex.
                    </p>
                    {job && (
                      <section className="answer">
                        <div className="sectionhead">
                          <h2>{job.goal}</h2>
                          <span className="tag">{job.status}</span>
                        </div>
                        {job.status === "running" && (
                          <>
                            <p>
                              O Codex está trabalhando. Acompanhe as leituras
                              reais abaixo.
                            </p>
                            <button
                              onClick={() =>
                                act(async () => {
                                  await api("/job/cancel", { id: job.id });
                                  await refresh();
                                })
                              }
                            >
                              <Pause />
                              Cancelar execução
                            </button>
                          </>
                        )}
                        {job.error && <p className="error">{job.error}</p>}
                        <ul>
                          {job.events.map((e, i) => (
                            <li key={i}>
                              {e.text}: {e.path}
                            </li>
                          ))}
                        </ul>
                        {!job.implementation&&job.execution&&<ProposalExecution row={job.execution} busy={busy} undo={undoExecution} retry={decideProposal}/>}
                        {job.implementation&&<ProposalExecution row={executions.find(r=>r.id===job.implementation.id)||{status:'planning',message:'Preparando melhoria.',jobId:job.id}} busy={busy} undo={undoExecution} retry={decideProposal}/>}
                        {job.result && !job.implementation && (
                          <>
                            <h3>Resultado do Codex</h3>
                            <div className="real-result">
                              {job.result.summary}
                            </div>
                            <div className="sources">
                              {job.result.sourcePaths.map((path) => (
                                <button
                                  key={path}
                                  onClick={() => openNote(path)}
                                >
                                  {path}
                                </button>
                              ))}
                            </div>
                            <div className="actions">
                              <button
                                onClick={() =>
                                  act(async () => {
                                    const r = await api("/note", {
                                      path: "notes/results/" + job.id + ".md",
                                      body:
                                        "# " +
                                        job.goal +
                                        "\n\n" +
                                        job.result.summary +
                                        "\n\nFontes:\n" +
                                        job.result.sourcePaths.join("\n"),
                                      create: true,
                                    });
                                    setMessage(
                                      "Resultado gravado e relido via MCP.",
                                    );
                                    await refresh();
                                  })
                                }
                              >
                                Guardar resultado
                              </button>
                              {job.proposalDecision && <span className="caption">{job.proposalDecision.status==='accepted'?'Aceita para execução':job.proposalDecision.status==='resolved'?'Resolvida':'Dispensada'} · <button disabled={busy} onClick={()=>decideProposal(job.id,'open')}>Reabrir proposta</button></span>}
                              <button
                                className="primary"
                                onClick={() => {
                                  setProposal(null);
                                  setLearningDraft(job.result.learning);
                                }}
                              >
                                Revisar aprendizado proposto
                              </button>
                            </div>
                          </>
                        )}
                      </section>
                    )}
                    {learningDraft && (
                      <section className="learningbox">
                        <span className="eyebrow">
                          SERVIÇO NATIVO DE APRENDIZADO
                        </span>
                        <h2>Da evidência ao princípio reutilizável</h2>
                        <p>
                          A proposta ainda não está ativa. O KeepMind pode
                          rejeitar conteúdo específico ou uma fonte inválida;
                          nenhuma proteção será contornada.
                        </p>
                        <label className="field">
                          Fonte
                          <select
                            value={learningDraft.sourcePath || ""}
                            onChange={(e) => {
                              setProposal(null);
                              setLearningDraft({
                                ...learningDraft,
                                sourcePath: e.target.value,
                              });
                            }}
                          >
                            <option value="">Selecione uma fonte</option>
                            {notes.map((n) => (
                              <option key={n.path} value={n.path}>
                                {n.path}
                              </option>
                            ))}
                          </select>
                        </label>
                        {[
                          ["body", "Aprendizado"],
                          ["purpose", "Finalidade"],
                          ["applicability", "Aplicabilidade"],
                        ].map(([key, label]) => (
                          <label className="field" key={key}>
                            {label}
                            <textarea
                              value={learningDraft[key]}
                              onChange={(e) => {
                                setProposal(null);
                                setLearningDraft({
                                  ...learningDraft,
                                  [key]: e.target.value,
                                });
                              }}
                            />
                          </label>
                        ))}
                        <button
                          disabled={busy || !learningDraft.sourcePath}
                          onClick={() =>
                            act(async () => {
                              const p = await api("/learning/propose", {
                                path: learningDraft.sourcePath,
                                body: learningDraft.body,
                                purpose: learningDraft.purpose,
                                applicability: learningDraft.applicability,
                              });
                              setProposal(p);
                              await refresh();
                            })
                          }
                        >
                          Validar e preparar revisão
                        </button>
                        {proposal && (
                          <div className="reviewdiff">
                            <small>REVISÃO EXATA · {proposal.status}</small>
                            <p>{proposal.body}</p>
                            <p>
                              {proposal.purpose} · {proposal.applicability}
                            </p>
                            {proposal.status === "pending" ? (
                              <button
                                className="primary"
                                disabled={busy}
                                onClick={() =>
                                  act(async () => {
                                    const active = await api(
                                      "/learning/approve",
                                      {
                                        id: proposal.id,
                                        approvalDigest: proposal.approvalDigest,
                                        approved: true,
                                      },
                                    );
                                    setProposal(active);
                                    setMessage(
                                      "Aprendizado operacional ativo no acervo conectado.",
                                    );
                                    await refresh();
                                  })
                                }
                              >
                                Aprovar este aprendizado
                              </button>
                            ) : (
                              <button
                                className="primary"
                                onClick={() =>
                                  setSkillDraft({
                                    learningId: proposal.id,
                                    name:
                                      job?.result?.skill?.name ||
                                      proposal.purpose,
                                    steps: (
                                      job?.result?.skill?.steps || [
                                        proposal.body,
                                      ]
                                    ).join("\n"),
                                    checks: (
                                      job?.result?.skill?.checks || [
                                        "Confirmar evidências",
                                      ]
                                    ).join("\n"),
                                  })
                                }
                              >
                                Transformar em skill real
                              </button>
                            )}
                          </div>
                        )}
                      </section>
                    )}
                    {skillDraft && (
                      <section className="routinebox">
                        <span className="eyebrow">
                          SKILL COMPARTILHADA VIA MCP
                        </span>
                        <h2>
                          {skillDraft.path
                            ? "Evoluir procedimento"
                            : "Criar procedimento reutilizável"}
                        </h2>
                        <label className="field">
                          Nome
                          <input
                            value={skillDraft.name}
                            onChange={(e) =>
                              setSkillDraft({
                                ...skillDraft,
                                name: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          Etapas, uma por linha
                          <textarea
                            value={skillDraft.steps}
                            onChange={(e) =>
                              setSkillDraft({
                                ...skillDraft,
                                steps: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          Critérios, um por linha
                          <textarea
                            value={skillDraft.checks}
                            onChange={(e) =>
                              setSkillDraft({
                                ...skillDraft,
                                checks: e.target.value,
                              })
                            }
                          />
                        </label>
                        <p className="caption">
                          Evoluções só substituem a versão atual após passarem nos testes.
                        </p>
                        <button
                          className="primary"
                          disabled={busy || !skillDraft.name.trim()}
                          onClick={() =>
                            act(async () => {
                              const saved = await api("/skill", {
                                ...skillDraft,
                                steps: skillDraft.steps
                                  .split("\n")
                                  .filter(Boolean),
                                checks: skillDraft.checks
                                  .split("\n")
                                  .filter(Boolean),
                              });
                              setSkillDraft(null);
                              setMessage(saved.pendingEvolution ? (saved.pendingEvolution.status === "needs-suite" ? "Candidata salva; falta um teste específico. Versão atual mantida." : "Candidata salva e aguardando testes. Versão atual mantida.") : "Skill gravada no cofre real.");
                              await refresh();
                              setTab("Skills");
                              go("configuracoes");
                            })
                          }
                        >
                          Confirmar e gravar skill
                        </button>
                      </section>
                    )}
                  </section>
                  <section className="panel context">
                    <h3>Contexto autorizado</h3>
                    <p>
                      Codex · acesso de leitura via MCP. Nenhuma chave do cofre
                      é entregue ao agente.
                    </p>
                    <span className="eyebrow">SELECIONE AS FONTES</span>
                    {notes.slice(0, 100).map((n) => (
                      <label className="sourcecheck" key={n.path}>
                        <input
                          type="checkbox"
                          checked={selected.includes(n.path)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, n.path]
                                : selected.filter((p) => p !== n.path),
                            )
                          }
                        />
                        {n.title}
                      </label>
                    ))}
                    {!notes.length && <p>Guarde uma nota para iniciar.</p>}
                    <p className="caption">
                      Máximo de dez fontes por execução. Serviços locais
                      precisam continuar abertos.
                    </p>
                    <button className="textlink" onClick={() => go("memoria")}>
                      Explorar todas as fontes
                    </button>
                  </section>
                </div>
              </>
            )}
          </>
        )}
        {page === "configuracoes" && (
          <>
            <div className="heading">
              <span className="eyebrow">CONFIGURAÇÕES</span>
              <h1>{new URLSearchParams(location.search).has("surface") ? tab : "Seu cérebro. Seus limites."}</h1>
              <p>Conexão real, aprendizado revisado e skills portáveis.</p>
            </div>
            <div className="settingstabs">
              {configTabs.map((t) => (
                <button
                  key={t}
                  className={tab === t ? "active" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            {tab === "Conexão" ? (
              connection
            ) : tab === "Skills" ? (
              <SkillsLibrary skills={skills} available={live&&skillsLoaded&&!skillsError} loading={live&&!skillsLoaded} busy={busy} openNote={openNote} launch={launch} act={act} refresh={refresh} propose={s=>{setSkillDraft({...s.metadata,path:s.path,etag:s.etag,steps:s.metadata.steps.join("\n"),checks:s.metadata.checks.join("\n")});go("assistente")}}>
                {live&&today?.cycles&&<details className="skill-evolution"><summary>Evoluções e evidências</summary><CycleSettings cycles={today.cycles} autonomy={today.autonomy} act={act} refresh={refresh}/></details>}
              </SkillsLibrary>
            ) : tab === "Rotinas" ? (
              today?.cycles ? <CycleSettings cycles={today.cycles} autonomy={today.autonomy} act={act} refresh={refresh}/> : <section className="panel"><h2>Rotinas</h2><p>Gerencie as rotinas deste cofre no aplicativo nativo.</p></section>
            ) : tab === "Segurança" ? (
              <>
                {connection}
                <section className="panel">
                  <h2>Limites da conexão</h2>
                  <p>
                    O navegador confirma mudanças. O Codex só recebe as
                    ferramentas sb_list e sb_read para as fontes selecionadas. O
                    desbloqueio dura apenas nesta sessão da ponte; a senha não é
                    armazenada.
                  </p>
                  <p>
                    Gerencie criação de chaves, recuperação e espaços no
                    aplicativo nativo. Nenhuma chave é criada automaticamente
                    por esta integração.
                  </p>
                </section>
              </>
            ) : tab === "Saúde" ? (
              <RealHealth today={today} status={status} onMetric={setMetric} act={act} refresh={refresh} openNote={openNote}/>
            ) : tab === "Modelos" ? (
              <section className="panel">
                <h2>Codex primeiro, memória independente</h2>
                <p>
                  Esta integração usa o Codex CLI e seu modelo configurado.
                  Claude, Grok Bot e outros conectores existentes continuam
                  disponíveis no KeepMind nativo; não são apresentados aqui como
                  conectados sem verificação.
                </p>
                <p>
                  Nenhuma chave de API é solicitada. O login do Codex é feito no
                  próprio aplicativo/CLI.
                </p>
              </section>
            ) : (
              <section className="panel">
                <h2>Continuidade das funcionalidades</h2>
                <p>
                  O aplicativo nativo continua responsável por sincronização
                  GitHub, grafo completo, flashcards, gestão dos demais
                  conectores e configurações de segurança. Os ciclos do cérebro ficam no serviço persistente.
                  Seus dados e configurações não foram substituídos pelo
                  protótipo.
                </p>
                <p>
                  O layout demonstrativo anterior permanece isolado, sem acesso
                  automático ao cofre.
                </p>
                <a className="textlink" href="/?demo=1#hoje">
                  Abrir demonstração anterior
                </a>
              </section>
            )}
          </>
        )}
      </main>
      {modal && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={modal === "unlock" ? "Desbloquear cofre" : "Nota real"}
          >
            <button
              className="close"
              aria-label="Fechar"
              onClick={() => {
                setModal(null);
                setPassword("");
              }}
            >
              <X />
            </button>
            {modal === "unlock" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    const p = password;
                    setPassword("");
                    await api("/unlock", { passphrase: p });
                    setModal(null);
                    await refresh();
                    setMessage("Cofre desbloqueado no processo MCP.");
                  });
                }}
              >
                <Lock size={32} />
                <h2>Desbloquear cofre real</h2>
                <p>
                  Use a senha configurada no KeepMind nativo. Ela é enviada
                  apenas à ponte local, por esta conexão, e não é armazenada.
                </p>
                <label className="field">
                  Senha do cofre
                  <input
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
                <button className="primary" disabled={busy || !password}>
                  Desbloquear
                </button>
              </form>
            ) : (
              editor && (
                <>
                  <h2>
                    {editor.create
                      ? "Guardar na memória real"
                      : editor.readOnly ? "Fonte original · somente leitura" : "Editar nota real"}
                  </h2>
                  <label className="field">
                    Arquivo
                    <input
                      value={editor.path}
                      readOnly={!editor.create}
                      onChange={(e) =>
                        setEditor({ ...editor, path: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Conteúdo
                    <textarea
                      rows={12}
                      readOnly={!!editor.readOnly}
                      value={editor.body}
                      onChange={(e) =>
                        setEditor({ ...editor, body: e.target.value })
                      }
                    />
                  </label>
                  <p className="caption">
                    {status?.mode === "shared-markdown" ? "Formato Markdown preservado. Fontes originais são somente leitura; novos registros ficam em KeepMind-Bridge." : "Criptografado pelo KeepMind. Alterações concorrentes são detectadas antes de salvar."}
                  </p>
                  <button
                    className="primary"
                    disabled={busy || !!editor.readOnly || !editor.body.trim()}
                    onClick={() =>
                      act(async () => {
                        const saved = await api("/note", editor);
                        setEditor(saved);
                        await refresh();
                        setMessage("Nota gravada e relida via MCP.");
                        setModal(null);
                      })
                    }
                  >
                    Guardar via MCP
                  </button>
                </>
              )
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
