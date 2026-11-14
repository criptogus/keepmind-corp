import { Cycle, Outcome, Profile, Routines } from "./Workflow.jsx";
import { defaultProfile, createTask, sourceNotes } from "./workflow.js";
import cytoscape from "cytoscape";
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
  Graph,
  Clock,
  ShieldCheck,
  Plugs,
  Lightning,
  CheckCircle,
  X,
  PaperPlane,
  Pause,
  Play,
  ArrowCounterClockwise,
  Download,
  Lock,
  BookOpen,
  Trash,
  Command,
} from "@phosphor-icons/react";
const seed = [
  {
    id: "1",
    title: "Estratégia do produto",
    type: "Projeto",
    body: "Objetivo: tornar o conhecimento pessoal útil no momento certo.\n\nPrioridades: captura simples, respostas com fontes e revisão de alterações.\nPrazo anterior: 18 de novembro.",
    date: "Hoje",
  },
  {
    id: "2",
    title: "Pesquisa de referências",
    type: "Pesquisa",
    body: "Obsidian: edição e conexões entre notas.\nGitHub: histórico e portabilidade.\nKeepMind: memória compartilhada entre agentes, com revisão humana.",
    date: "Ontem",
  },
  {
    id: "3",
    title: "Ideias para explorar",
    type: "Nota",
    body: "Relacionar decisões de produto com evidências da pesquisa. Preparar uma revisão semanal com fontes.",
    date: "Há 2 dias",
  },
  {
    id: "4",
    title: "Reunião de segunda",
    type: "Reunião",
    body: "Proposta: mover o prazo do projeto para 25 de novembro. Confirmar antes de atualizar o planejamento.",
    date: "Ontem",
  },
];
function useSaved(key, initial) {
  const [v, set] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {}
  }, [v]);
  return [v, set];
}
const tabs = [
  "Geral",
  "Conexões",
  "Automações",
  "Skills",
  "Segurança",
  "Saúde",
  "Modelos",
  "Sincronização",
  "Avançado",
];
function Button({ children, onClick, primary = false, ...rest }) {
  return (
    <button className={primary ? "primary" : ""} onClick={onClick} {...rest}>
      {children}
    </button>
  );
}
export default function App() {
  const [page, setPage] = useState(location.hash.slice(1) || "hoje"),
    [notes, setNotes] = useSaved("km-demo-notes", seed),
    [settings, setSettings] = useSaved("km-demo-settings", {
      auto: true,
      locked: false,
      sync: true,
      model: "Codex",
      jobs: true,
    }),
    [reviewed, setReviewed] = useSaved("km-demo-reviewed", false),
    [history, setHistory] = useSaved("km-demo-history", []),
    [profile, setProfile] = useSaved("km-demo-profile", defaultProfile),
    [routines, setRoutines] = useSaved("km-demo-routines", []),
    [runs, setRuns] = useSaved("km-demo-runs", []);
  const [modal, setModal] = useState(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("Todos"),
    [view, setView] = useState("Lista"),
    [tab, setTab] = useState("Geral"),
    [draft, setDraft] = useState(""),
    [title, setTitle] = useState(""),
    [intent, setIntent] = useState(""),
    [task, setTask] = useSaved("km-demo-task-v2", null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [messages, setMessages] = useState([]),
    [skill, setSkill] = useSaved("km-demo-skills", [
      "Conectar ideias",
      "Resumir",
      "Revisão semanal",
    ]);
  const search = useRef(null);
  const [selectedIds, setSelectedIds] = useState(null);
  useEffect(() => {
    setTask((t) => (t?.status === "running" ? { ...t, status: "paused" } : t));
  }, []);
  useEffect(() => {
    if (task?.status === "done" && task.id) {
      setRuns((rs) =>
        rs.some((r) => r.id === task.id)
          ? rs
          : [
              {
                id: task.id,
                goal: task.goal,
                routineId: task.routineId,
                finishedAt: new Date().toISOString(),
                sourceCount: sourceNotes(task).length,
              },
              ...rs,
            ],
      );
    }
  }, [task?.status, task?.id]);
  const go = (p) => {
    setPage(p);
    location.hash = p;
    setQuery("");
  };
  useEffect(() => {
    const f = () => setPage(location.hash.slice(1) || "hoje");
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const tell = (t) => {
    setToast(t);
    setTimeout(() => setToast(""), 3500);
  };
  const log = (t) =>
    setHistory((h) => [
      {
        text: t,
        time: new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
      ...h,
    ]);
  const openCapture = () => {
    setDraft("");
    setTitle("");
    setError("");
    setModal("capture");
  };
  useEffect(() => {
    const f = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        go("memoria");
        setTimeout(() => search.current?.focus(), 40);
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "m"
      ) {
        e.preventDefault();
        openCapture();
      }
      if (e.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  useEffect(() => {
    if (task?.status !== "running" || settings.locked) return;
    const timer = setTimeout(
      () =>
        setTask((t) =>
          t?.status === "running"
            ? {
                ...t,
                step: t.step + 1,
                status: t.step >= 2 ? "done" : "running",
              }
            : t,
        ),
      1200,
    );
    return () => clearTimeout(timer);
  }, [task, settings.locked]);
  const openNote = (n) => {
    if (settings.locked) {
      setModal("unlock");
      return;
    }
    setModal({ note: n });
    setTitle(n.title);
    setDraft(n.body);
    setError("");
  };
  const startTask = (value, routine = null) => {
    if (!value.trim()) return;
    if (settings.locked) {
      setModal("unlock");
      return;
    }
    const ids = routine?.sourceIds ?? selectedIds;
    const next = createTask(
      value,
      notes,
      routine ? { ...profile, scope: routine.scope } : profile,
      settings.auto,
      ids,
      routine?.id,
    );
    if (!next.sources.length) {
      tell("Selecione ao menos uma fonte disponível antes de iniciar.");
      go("assistente");
      return;
    }
    if (routine && next.sources.length !== routine.sourceIds.length) {
      tell(
        "Uma fonte da rotina está indisponível. Revise o contexto antes de executar.",
      );
      return;
    }
    if (task && ["running", "paused", "planned"].includes(task.status)) {
      tell("Conclua ou encerre a tarefa atual antes de iniciar outra.");
      go("assistente");
      return;
    }
    next.executor = settings.model;
    if (routine)
      next.skill = {
        name: routine.name,
        version: routine.version || 1,
        steps: [...routine.steps],
      };
    setTask(next);
    setIntent("");
    go("assistente");
    log("Execução demonstrativa iniciada: " + value);
  };
  const save = () => {
    if (modal?.note?.snapshot) return;
    if (settings.locked) {
      setError(
        "Memória bloqueada. Desbloqueie em Configurações → Segurança. Seu texto foi preservado.",
      );
      return;
    }
    if (!draft.trim()) {
      setError("Escreva algo para guardar.");
      return;
    }
    if (modal?.note) {
      setNotes((ns) =>
        ns.map((n) =>
          n.id === modal.note.id
            ? {
                ...n,
                title: title.trim() || n.title,
                body: draft,
                date: "Hoje",
              }
            : n,
        ),
      );
      log("Nota atualizada: " + title);
    } else {
      setNotes((ns) => [
        {
          id: crypto.randomUUID(),
          title: title.trim() || draft.slice(0, 55),
          body: draft,
          type: "Nota",
          date: "Hoje",
        },
        ...ns,
      ]);
      log("Uma nova memória foi guardada");
    }
    setModal(null);
    tell("Guardado neste navegador");
  };
  const applyReview = () => {
    setNotes((ns) =>
      ns.map((n) =>
        n.id === "1"
          ? {
              ...n,
              body:
                n.body +
                "\n\nAtualização revisada: prazo de 25 de novembro. Fonte: Reunião de segunda.",
            }
          : n,
      ),
    );
    setReviewed(true);
    setModal(null);
    log("Alteração de prazo aprovada");
    tell("Alteração aplicada. Você pode desfazer no histórico.");
  };
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement;
    const dialog = document.querySelector("[role=dialog]");
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll(
          'button:not(:disabled),input,textarea,select,summary,[tabindex="0"]',
        ) || [],
      );
    focusable()[0]?.focus();
    const trap = (e) => {
      if (e.key !== "Tab") return;
      const list = focusable();
      if (e.shiftKey && document.activeElement === list[0]) {
        e.preventDefault();
        list.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === list.at(-1)) {
        e.preventDefault();
        list[0]?.focus();
      }
    };
    dialog?.addEventListener("keydown", trap);
    return () => {
      dialog?.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [modal]);
  const nav = [
    ["hoje", "Hoje", Sun],
    ["memoria", "Memória", Stack],
    ["assistente", "Assistente", ChatCircle],
  ];
  const results = notes.filter(
    (n) =>
      (filter === "Todos" || n.type === filter) &&
      (n.title + " " + n.body).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <img src="/assets/keepmind.png" alt="" />
          <div>
            <b>
              KEEP<span>MIND</span>
            </b>
            <small>Seu segundo cérebro</small>
          </div>
        </div>
        <Button primary onClick={openCapture}>
          <Plus size={22} /> Guardar
        </Button>
        <nav>
          {nav.map(([id, label, Icon]) => (
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
            <span className={settings.locked ? "dot amber" : "dot"} />
            {settings.locked ? "Memória bloqueada" : "Memória disponível"}
            <button
              className="textlink"
              onClick={() => {
                setTab("Conexões");
                go("configuracoes");
              }}
            >
              Ver conexões
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <label className="search">
            <MagnifyingGlass size={21} />
            <input
              ref={search}
              aria-label="Buscar na memória"
              placeholder="Buscar na memória"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (page !== "memoria") {
                  setPage("memoria");
                  location.hash = "memoria";
                }
              }}
            />
            <kbd>⌘ K</kbd>
          </label>
          <span className="demobadge">PROTÓTIPO · DADOS LOCAIS</span>
          <button className="mobilecapture primary" onClick={openCapture}>
            <Plus />
            Guardar
          </button>
        </header>
        {page === "hoje" && (
          <>
            <div className="heading">
              <span className="eyebrow">HOJE</span>
              <h1>Seu conhecimento, pronto para usar.</h1>
              <p>Guarde ideias. Encontre respostas. Retome o que importa.</p>
            </div>
            <form
              className="intent"
              onSubmit={(e) => {
                e.preventDefault();
                startTask(intent);
              }}
            >
              <label className="eyebrow" htmlFor="goal">
                O QUE VOCÊ QUER FAZER?
              </label>
              <div className="inputrow">
                <input
                  id="goal"
                  placeholder="Pergunte à sua memória ou descreva uma tarefa…"
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                />
                <button className="cyan" aria-label="Iniciar tarefa">
                  <ArrowRight size={25} />
                </button>
              </div>
              <div className="suggestions">
                <button
                  type="button"
                  onClick={() => startTask("Resumir um assunto")}
                >
                  <FileText />
                  Resumir um assunto
                </button>
                <button
                  type="button"
                  onClick={() => startTask("Retomar um projeto")}
                >
                  <Stack />
                  Retomar um projeto
                </button>
              </div>
            </form>
            {settings.locked ? (
              <section className="panel decision">
                <div>
                  <span className="eyebrow">PRECISA DE VOCÊ</span>
                  <h2>Desbloqueie sua memória para continuar.</h2>
                  <p>
                    O repositório está conectado, mas o conteúdo está bloqueado.
                  </p>
                </div>
                <Button onClick={() => setModal("unlock")}>Desbloquear</Button>
              </section>
            ) : !reviewed ? (
              <section className="panel decision">
                <div>
                  <span className="eyebrow">PRECISA DE VOCÊ</span>
                  <h2>Uma informação mudou</h2>
                  <p>
                    O KeepMind encontrou duas versões para o prazo do projeto.
                  </p>
                  <div className="sources">
                    <button
                      onClick={() =>
                        openNote(notes.find((n) => n.id === "1") || notes[0])
                      }
                    >
                      <FileText />
                      Planejamento.md
                    </button>
                    <button
                      onClick={() =>
                        openNote(notes.find((n) => n.id === "4") || notes[0])
                      }
                    >
                      <FileText />
                      Reunião de segunda.md
                    </button>
                  </div>
                </div>
                <Button onClick={() => setModal("review")}>
                  Revisar alteração
                </Button>
              </section>
            ) : (
              <section className="panel decision">
                <div>
                  <span className="eyebrow">TUDO EM DIA</span>
                  <h2>Suas decisões estão atualizadas.</h2>
                  <p>A alteração foi registrada com a fonte original.</p>
                </div>
                <CheckCircle size={30} />
              </section>
            )}
            <div className="columns">
              <section className="panel">
                <h2>O que sua memória preparou</h2>
                <div className="resultrow">
                  <div className="tile">
                    <Graph size={28} />
                  </div>
                  <div>
                    <h3>Uma conexão para explorar</h3>
                    <p>Suas notas de pesquisa se conectam ao projeto atual.</p>
                    <button
                      className="textlink"
                      onClick={() => {
                        setView("Conexões");
                        go("memoria");
                      }}
                    >
                      Ver conexão · 3 fontes
                    </button>
                  </div>
                  <ArrowRight />
                </div>
                <div className="resultrow">
                  <div className="tile">
                    <FileText size={28} />
                  </div>
                  <div>
                    <h3>Sua revisão está pronta</h3>
                    <p>Decisões e ideias da semana reunidas para você.</p>
                    <button
                      className="textlink"
                      onClick={() =>
                        startTask("Preparar minha revisão semanal")
                      }
                    >
                      Abrir revisão · fontes de exemplo
                    </button>
                  </div>
                  <ArrowRight />
                </div>
              </section>
              <section className="panel">
                <h2>Continue de onde parou</h2>
                {notes.slice(0, 3).map((n) => (
                  <button
                    className="noterow"
                    key={n.id}
                    onClick={() => openNote(n)}
                  >
                    <FileText size={28} />
                    <span>
                      <b>{n.title}</b>
                      <small>Editado {n.date.toLowerCase()}</small>
                    </span>
                    <ArrowRight />
                  </button>
                ))}
                <button className="textlink" onClick={() => go("memoria")}>
                  Abrir memória <ArrowRight />
                </button>
              </section>
            </div>
            <button
              className="textlink historylink"
              onClick={() => setModal("history")}
            >
              Ver histórico de atividades
            </button>
            <section className="panel intelligence">
              <span className="eyebrow">INTELIGÊNCIA EM EVOLUÇÃO</span>
              <h2>O trabalho dos seus agentes vira memória e skills.</h2>
              <p>
                {runs.length} execuções demonstrativas concluídas ·{" "}
                {notes.filter((n) => n.type === "Aprendizado").length}{" "}
                aprendizados registrados · {routines.length} skills
                reutilizáveis
              </p>
              <div className="actions">
                <Button
                  onClick={() => startTask("Revisar e melhorar a memória")}
                >
                  Iniciar ciclo de evolução
                </Button>
                <Button
                  onClick={() => {
                    setTab("Skills");
                    go("configuracoes");
                  }}
                >
                  Gerenciar skills
                </Button>
              </div>
            </section>
          </>
        )}
        {page === "memoria" && (
          <>
            <div className="heading">
              <span className="eyebrow">MEMÓRIA</span>
              <h1>Encontre. Conecte. Reutilize.</h1>
              <p>Seu conhecimento e suas fontes, em um só lugar.</p>
            </div>
            <div className="toolbar">
              <div className="segmented">
                {["Lista", "Conexões", "Revisar", "Meu contexto"].map((v) => (
                  <button
                    className={view === v ? "active" : ""}
                    onClick={() => setView(v)}
                    key={v}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <Button onClick={() => setModal("import")}>
                <Download />
                Importar conteúdo
              </Button>
            </div>
            {settings.locked ? (
              <section className="panel">
                <Lock size={32} />
                <h2>Conteúdo protegido</h2>
                <p>Desbloqueie a memória para consultar e editar.</p>
                <Button onClick={() => setModal("unlock")}>
                  Desbloquear demonstração
                </Button>
              </section>
            ) : view === "Meu contexto" ? (
              <Profile
                profile={profile}
                setProfile={setProfile}
                notes={notes}
              />
            ) : view === "Lista" ? (
              <>
                <div className="chips">
                  {[
                    "Todos",
                    "Projeto",
                    "Pesquisa",
                    "Nota",
                    "Reunião",
                    "Aprendizado",
                  ].map((f) => (
                    <button
                      className={filter === f ? "active" : ""}
                      key={f}
                      onClick={() => setFilter(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <section className="panel library">
                  {results.length ? (
                    results.map((n) => (
                      <button
                        className="noterow"
                        key={n.id}
                        onClick={() => openNote(n)}
                      >
                        <FileText size={28} />
                        <span>
                          <b>{n.title}</b>
                          <small>{n.body.slice(0, 100)}</small>
                        </span>
                        <span className="tag">{n.type}</span>
                        <small>{n.date}</small>
                        <ArrowRight />
                      </button>
                    ))
                  ) : (
                    <div className="empty">
                      <MagnifyingGlass size={36} />
                      <h2>Nenhuma memória encontrada</h2>
                      <p>Tente outro termo ou guarde uma nova ideia.</p>
                      <Button
                        onClick={() => {
                          setQuery("");
                          setFilter("Todos");
                        }}
                      >
                        Limpar filtros
                      </Button>
                    </div>
                  )}
                </section>
                <p className="caption">
                  {results.length} itens · Busca textual nesta demonstração ·
                  Arquivos Markdown exportáveis
                </p>
              </>
            ) : view === "Conexões" ? (
              <section className="panel">
                <div className="sectionhead">
                  <h2>Conexões com contexto</h2>
                  <Graph size={28} />
                </div>
                <p>
                  Explore o grafo ou use a lista de relações abaixo. Clique em
                  uma nota para abrir. Relações demonstrativas.
                </p>
                <KnowledgeGraph notes={notes} onOpen={openNote} />
                {notes.slice(0, 7).map((n, i) => (
                  <div className="relation" key={n.id}>
                    <button onClick={() => openNote(n)}>
                      <FileText />
                      {n.title}
                    </button>
                    <span>
                      {["fundamenta", "inspira", "complementa"][i % 3]}
                    </span>
                    <ArrowRight />
                    <button
                      onClick={() => openNote(notes[(i + 1) % notes.length])}
                    >
                      {notes[(i + 1) % notes.length]?.title}
                    </button>
                  </div>
                ))}
                <Button
                  onClick={() =>
                    startTask("Encontrar conexões entre minhas notas")
                  }
                >
                  Explorar com o assistente
                </Button>
              </section>
            ) : (
              <section className="panel">
                <span className="eyebrow">REVISÃO ESPAÇADA · DEMONSTRAÇÃO</span>
                <h2>Qual é a prioridade da estratégia do produto?</h2>
                <p>Fonte: Estratégia do produto</p>
                <Button onClick={() => setModal("card")}>
                  Mostrar resposta
                </Button>
                <hr />
                <h3>Fatos e decisões</h3>
                <p>
                  {reviewed
                    ? "Nenhuma alteração pendente."
                    : "Uma mudança de prazo precisa de revisão."}
                </p>
                {!reviewed && (
                  <Button onClick={() => setModal("review")}>
                    Revisar mudança
                  </Button>
                )}
              </section>
            )}
          </>
        )}
        {page === "assistente" && (
          <>
            <div className="heading">
              <span className="eyebrow">ASSISTENTE</span>
              <h1>Seu LLM trabalha. Seu cérebro evolui.</h1>
              <p>
                Ciclo de memória, aprendizado e evolução via MCP. Execução
                simulada no agente que você já usa.
              </p>
            </div>
            {task && <Cycle task={task} />}
            <div className="assistantlayout">
              <section className="panel conversation">
                {!task ? (
                  <div className="empty">
                    <ChatCircle size={48} />
                    <h2>O que vamos resolver?</h2>
                    <p>Escolha um objetivo ou escreva o seu.</p>
                    <div className="chips">
                      {[
                        "Revisar e melhorar a memória",
                        "Aprender com a última execução",
                        "Evoluir uma skill com evidências",
                      ].map((t) => (
                        <Button key={t} onClick={() => startTask(t)}>
                          {t}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="usermessage">
                      <span className="eyebrow">SEU OBJETIVO</span>
                      <h2>{task.goal}</h2>
                    </div>
                    {settings.locked && (
                      <div className="notice">
                        Memória bloqueada. A execução está suspensa até o
                        desbloqueio.
                      </div>
                    )}
                    <div className="agentmessage">
                      <div className="sectionhead">
                        <h3>
                          {task.status === "done"
                            ? "Resultado preparado"
                            : task.status === "paused"
                              ? "Execução pausada"
                              : task.status === "planned"
                                ? "Plano pronto para iniciar"
                                : "Organizando seu conhecimento"}
                        </h3>
                        <span className="tag">SIMULAÇÃO</span>
                      </div>
                      <ol className="steps">
                        {[
                          "Entregar contexto ao agente via MCP (simulado)",
                          "Revisar memória, decisões e procedimentos",
                          "Preparar resultado e aprendizado com fontes",
                        ].map((s, i) => (
                          <li
                            key={s}
                            className={i <= task.step ? "complete" : ""}
                          >
                            {i < task.step || task.status === "done" ? (
                              <CheckCircle />
                            ) : (
                              <Clock />
                            )}
                            {s}
                          </li>
                        ))}
                      </ol>
                      {task.status === "done" ? (
                        <>
                          <Outcome
                            key={task.id}
                            task={task}
                            setTask={setTask}
                            notes={notes}
                            setNotes={setNotes}
                            routines={routines}
                            setRoutines={setRoutines}
                            openNote={openNote}
                            log={log}
                            tell={tell}
                            locked={settings.locked}
                            onRoutines={() => {
                              setTab("Automações");
                              go("configuracoes");
                            }}
                          />
                          <button onClick={() => setTask(null)}>
                            Novo objetivo
                          </button>
                        </>
                      ) : (
                        <Button
                          onClick={() =>
                            setTask({
                              ...task,
                              status:
                                task.status === "paused" ||
                                task.status === "planned"
                                  ? "running"
                                  : "paused",
                            })
                          }
                        >
                          {task.status === "paused" ||
                          task.status === "planned" ? (
                            <Play />
                          ) : (
                            <Pause />
                          )}
                          {task.status === "planned"
                            ? "Iniciar plano"
                            : task.status === "paused"
                              ? "Retomar"
                              : "Interromper"}
                        </Button>
                      )}
                    </div>
                  </>
                )}
                {task && task.status !== "done" && (
                  <button
                    className="textlink"
                    onClick={() => {
                      log(
                        "Tarefa encerrada sem alterar a memória: " + task.goal,
                      );
                      setTask(null);
                    }}
                  >
                    Encerrar tarefa
                  </button>
                )}
                <form
                  className="inputrow"
                  onSubmit={(e) => {
                    e.preventDefault();
                    startTask(intent);
                  }}
                >
                  <input
                    aria-label="Objetivo do assistente"
                    placeholder="Descreva o resultado que você precisa…"
                    value={intent}
                    onChange={(e) => setIntent(e.target.value)}
                  />
                  <button className="cyan" aria-label="Enviar objetivo">
                    <PaperPlane size={22} />
                  </button>
                </form>
              </section>
              <section className="panel context">
                <h3>Agente e memória</h3>
                {task?.skill && (
                  <div className="notice">
                    <b>
                      {task.skill.name} · v{task.skill.version}
                    </b>
                    <p>Procedimento herdado da skill</p>
                    <ol>
                      {task.skill.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                  </div>
                )}
                <label className="field">
                  LLM conectado
                  <select
                    aria-label="LLM conectado"
                    value={settings.model}
                    disabled={!!task && task.status !== "done"}
                    onChange={(e) =>
                      setSettings({ ...settings, model: e.target.value })
                    }
                  >
                    {[
                      "Codex",
                      "Claude Code",
                      "Grok Bot",
                      "Cursor Composer",
                      "Modelo local",
                    ].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <p className="caption">
                  MCP · conexão simulada.{" "}
                  {task
                    ? "Esta execução: " + task.executor
                    : "A mesma memória e skills, em diferentes LLMs."}
                </p>
                <p>Consultar e preparar conteúdo.</p>
                <p>
                  Alterações de fatos exigem sua revisão. Sem gastos ou
                  publicação.
                </p>
                <hr />
                <span className="eyebrow">
                  {task
                    ? "CONTEXTO DESTA EXECUÇÃO"
                    : "FONTES PARA A PRÓXIMA TAREFA"}
                </span>
                {task ? (
                  <>
                    <p>
                      {task.profile?.scope} · {task.profile?.voice}
                    </p>
                    <p>{task.profile?.principles}</p>
                    {sourceNotes(task).map((n) => (
                      <button
                        className="noterow"
                        key={n.id}
                        onClick={() => openNote({ ...n, snapshot: true })}
                      >
                        <FileText />
                        <span>{n.title}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  notes.map((n) => (
                    <label className="sourcecheck" key={n.id}>
                      <input
                        type="checkbox"
                        checked={(
                          selectedIds ??
                          notes
                            .filter((n) => n.type !== "Aprendizado")
                            .slice(0, 3)
                            .map((n) => n.id)
                        ).includes(n.id)}
                        onChange={(e) => {
                          const ids =
                            selectedIds ??
                            notes
                              .filter((n) => n.type !== "Aprendizado")
                              .slice(0, 3)
                              .map((n) => n.id);
                          setSelectedIds(
                            e.target.checked
                              ? [...ids, n.id]
                              : ids.filter((id) => id !== n.id),
                          );
                        }}
                      />
                      {n.title}
                    </label>
                  ))
                )}
                <button
                  className="textlink"
                  onClick={() => {
                    setView("Meu contexto");
                    go("memoria");
                  }}
                >
                  Editar meu contexto
                </button>
                <button
                  className="textlink"
                  onClick={() => {
                    setTab("Geral");
                    go("configuracoes");
                  }}
                >
                  Ajustar autonomia
                </button>
                <p className="caption">
                  A simulação depende desta página aberta.
                </p>
              </section>
            </div>
          </>
        )}
        {page === "configuracoes" && (
          <>
            <div className="heading">
              <span className="eyebrow">CONFIGURAÇÕES</span>
              <h1>Seu cérebro. Seus limites.</h1>
              <p>
                O essencial já organizado. Controles avançados sempre
                acessíveis.
              </p>
            </div>
            <div className="settingstabs">
              {tabs.map((t) => (
                <button
                  className={t === tab ? "active" : ""}
                  key={t}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <section className="panel settingspanel">
              <h2>{tab}</h2>
              {tab === "Geral" ? (
                <>
                  <Setting
                    title="Preparar tarefas automaticamente"
                    description="Organizar o plano e as fontes sem decisões intermediárias."
                    checked={settings.auto}
                    onChange={() =>
                      setSettings({ ...settings, auto: !settings.auto })
                    }
                  />
                  <div className="setting">
                    <div>
                      <h3>Aprovação para mudanças importantes</h3>
                      <p>
                        Excluir conteúdo, alterar fatos, publicar ou gastar
                        continuam exigindo decisão.
                      </p>
                    </div>
                    <ShieldCheck size={26} />
                  </div>
                  <Button onClick={() => setModal("history")}>
                    Histórico de atividades
                  </Button>
                  <Button onClick={() => setModal("reset")}>
                    Restaurar cenário de exemplo
                  </Button>
                  <p className="caption">
                    Conta demonstrativa · Português · Dados deste protótipo
                    salvos apenas neste navegador.
                  </p>
                </>
              ) : tab === "Conexões" ? (
                <>
                  <p>
                    Escolha onde seus agentes acessam a memória. Nenhuma conexão
                    real é alterada.
                  </p>
                  {[
                    "Codex",
                    "Claude Code",
                    "Cursor Composer",
                    "Grok Bot",
                    "GitHub",
                  ].map((name, i) => (
                    <div className="setting" key={name}>
                      <div>
                        <h3>{name}</h3>
                        <p>
                          {i === 0 || i === 4
                            ? "Conectado no cenário de exemplo"
                            : "Disponível para configuração"}
                        </p>
                      </div>
                      <Button onClick={() => setModal({ connection: name })}>
                        Configurar
                      </Button>
                    </div>
                  ))}
                </>
              ) : tab === "Automações" ? (
                <>
                  <Routines
                    routines={routines}
                    setRoutines={setRoutines}
                    onRun={(r) => startTask(r.goal, r)}
                    runs={runs}
                    enabled={settings.jobs}
                  />
                  <hr />
                  <h3>Rotinas do sistema</h3>
                  <Setting
                    title="Rotinas da memória"
                    description="Consolidação, revisão e manutenção. Estado demonstrativo."
                    checked={settings.jobs}
                    onChange={() =>
                      setSettings({ ...settings, jobs: !settings.jobs })
                    }
                  />
                  {[
                    "Consolidar memória (Sleep)",
                    "Resumo da manhã",
                    "Organização semanal",
                    "Evolução da memória",
                    "Enriquecer notas",
                    "Revisão espaçada",
                    "Auditoria de segurança",
                    "Evolução de skills",
                    "Triagem de capturas",
                    "Lacunas de busca",
                    "Compactação da memória",
                    "Briefing diário",
                  ].map((t) => (
                    <div className="setting" key={t}>
                      <div>
                        <h3>{t}</h3>
                        <p>
                          {settings.jobs
                            ? "Programada · demonstração"
                            : "Pausada"}{" "}
                          · fuso America/São_Paulo
                        </p>
                      </div>
                      <Button onClick={() => startTask(t)}>
                        Simular execução
                      </Button>
                    </div>
                  ))}
                  <Button
                    onClick={() => {
                      setDraft("");
                      setModal("automation");
                    }}
                  >
                    <Plus />
                    Nova automação
                  </Button>
                </>
              ) : tab === "Skills" ? (
                <>
                  <section className="customroutines">
                    <span className="eyebrow">APRENDIDAS COM EXECUÇÕES</span>
                    <h2>Skills portáveis entre LLMs</h2>
                    <p>
                      Procedimentos revisados, com fontes, critérios de
                      qualidade e histórico de versões. Disponibilização via MCP
                      simulada.
                    </p>
                    {routines.length ? (
                      routines.map((r) => (
                        <article key={r.id} className="routinecard">
                          <div className="sectionhead">
                            <h3>{r.name}</h3>
                            <span className="tag">
                              v{r.version || 1} ·{" "}
                              {r.enabled ? "DISPONÍVEL" : "PAUSADA"}
                            </span>
                          </div>
                          <p>{r.goal}</p>
                          <p className="caption">
                            Origem: {r.executor || "Agente"} · Escopo: {r.scope}
                          </p>
                          <ol>
                            {r.steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                          <p>Critérios: {r.checks.join(" · ")}</p><details><summary>Histórico de evolução</summary>{(r.versions||[]).map(v=><div className="setting" key={v.version}><div><b>v{v.version} · {v.executor||'Agente'}</b><p>{new Date(v.date).toLocaleString('pt-BR')}</p>{v.steps&&<ol>{v.steps.map(step=><li key={step}>{step}</li>)}</ol>}</div></div>)}</details>
                          <div className="actions">
                            <Button onClick={() => startTask(r.goal, r)}>
                              Testar e propor evolução
                            </Button>
                            <Button
                              onClick={() => {
                                setTab("Automações");
                              }}
                            >
                              Ver rotina vinculada
                            </Button>
                            <Button
                              onClick={() => {
                                const content = [
                                  "# " + r.name,
                                  "Versão: " + (r.version || 1),
                                  "Objetivo: " + r.goal,
                                  "Escopo: " + r.scope,
                                  "## Procedimento",
                                  ...r.steps.map((s, i) => i + 1 + ". " + s),
                                  "## Critérios",
                                  ...r.checks,
                                  "## Limites",
                                  r.limits,
                                  "## Fontes",
                                  ...r.sourceIds,
                                ].join("\n\n");
                                const u = URL.createObjectURL(
                                  new Blob([content], {
                                    type: "text/markdown",
                                  }),
                                );
                                const a = document.createElement("a");
                                a.href = u;
                                a.download = "keepmind-skill.md";
                                a.click();
                                URL.revokeObjectURL(u);
                              }}
                            >
                              Exportar skill Markdown
                            </Button>
                          </div>
                        </article>
                      ))
                    ) : (
                      <p>
                        Conclua um ciclo no Assistente para criar sua primeira
                        skill a partir de um aprendizado revisado.
                      </p>
                    )}
                  </section>
                  <hr />
                  <h3>Capacidades do sistema</h3>
                  <p>
                    Capacidades que o assistente pode usar para atingir seus
                    objetivos.
                  </p>
                  {[
                    "Conectar ideias",
                    "Resumir",
                    "Revisão semanal",
                    "Pesquisar referências",
                    "Organizar projetos",
                    "Preparar briefing",
                    "Consolidar fatos",
                  ].map((s) => (
                    <Setting
                      key={s}
                      title={s}
                      description="Disponibilidade no cenário demonstrativo"
                      checked={skill.includes(s)}
                      onChange={() =>
                        setSkill(
                          skill.includes(s)
                            ? skill.filter((k) => k !== s)
                            : [...skill, s],
                        )
                      }
                    />
                  ))}
                </>
              ) : tab === "Segurança" ? (
                <>
                  <div className="notice">
                    Protótipo sem criptografia real. Use somente conteúdo de
                    teste.
                  </div>
                  <Setting
                    title="Simular memória bloqueada"
                    description="Teste a recuperação de um estado em que os dados não podem ser lidos."
                    checked={settings.locked}
                    onChange={() =>
                      setSettings({ ...settings, locked: !settings.locked })
                    }
                  />
                  <div className="setting">
                    <div>
                      <h3>Criptografia, chaves e caminhos</h3>
                      <p>
                        Controles do app atual preservados no mapeamento. Chaves
                        reais não são solicitadas aqui.
                      </p>
                    </div>
                    <Button onClick={() => setModal("security")}>
                      Ver controles
                    </Button>
                  </div>
                  <Button
                    onClick={() =>
                      startTask("Verificar a saúde e a segurança da memória")
                    }
                  >
                    Simular diagnóstico
                  </Button>
                </>
              ) : tab === "Saúde" ? (
                <>
                  <div className="metrics">
                    <div>
                      <b>{notes.length}</b>
                      <span>Memórias locais</span>
                    </div>
                    <div>
                      <b>{skill.length}</b>
                      <span>Skills selecionadas</span>
                    </div>
                    <div>
                      <b>{settings.locked ? "Bloqueada" : "Pronta"}</b>
                      <span>Disponibilidade simulada</span>
                    </div>
                  </div>
                  <h3>
                    {settings.locked
                      ? "Uma ação necessária"
                      : "Nenhum bloqueio no cenário de exemplo"}
                  </h3>
                  <p>
                    Busca, fontes, insights, resumos e avaliações ficam
                    acessíveis a partir da memória.
                  </p>
                  <Button onClick={() => go("memoria")}>
                    Explorar memória
                  </Button>
                </>
              ) : tab === "Modelos" ? (
                <>
                  <label className="field">
                    Modelo preferido
                    <select
                      value={settings.model}
                      onChange={(e) =>
                        setSettings({ ...settings, model: e.target.value })
                      }
                    >
                      {["Codex", "Claude Code", "Modelo local"].map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                  <p>
                    Preferência local do protótipo. Não configura provedores nem
                    baixa runtimes.
                  </p>
                  <Button onClick={() => setModal("models")}>
                    Arquivos e runtimes
                  </Button>
                </>
              ) : tab === "Avançado" ? (
                <>
                  <h3>Busca semântica e índice</h3>
                  <p>
                    Estado demonstrativo: índice disponível. No app nativo,
                    ajuste embeddings, reindexação e recuperação aqui.
                  </p>
                  <Button
                    onClick={() =>
                      startTask("Verificar e reconstruir o índice de busca")
                    }
                  >
                    Simular reindexação
                  </Button>
                  <hr />
                  <h3>Política de decisões</h3>
                  <p>
                    Propostas de fatos e mudanças de política aparecem em Hoje
                    para revisão. As regras de roteamento rápido permanecem
                    nesta área.
                  </p>
                  <Button onClick={() => setModal("review")}>
                    Ver uma decisão preparada
                  </Button>
                  <hr />
                  <h3>Conta, atualizações e diagnóstico</h3>
                  <p>
                    Perfil local, preferências gerais, atualizações e
                    informações do app. O protótipo não altera a conta nativa.
                  </p>
                  <Button onClick={() => setModal("history")}>
                    Abrir registro local
                  </Button>
                </>
              ) : (
                <>
                  <Setting
                    title="Sincronização com GitHub"
                    description="Preferência de demonstração; nenhum repositório é acessado."
                    checked={settings.sync}
                    onChange={() =>
                      setSettings({ ...settings, sync: !settings.sync })
                    }
                  />
                  <Button
                    onClick={() => {
                      const blob = new Blob(
                        [
                          notes
                            .map((n) => "# " + n.title + "\n\n" + n.body)
                            .join("\n\n---\n\n"),
                        ],
                        { type: "text/markdown" },
                      );
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "keepmind-demo.md";
                      a.click();
                      URL.revokeObjectURL(url);
                      tell("Exportação preparada");
                    }}
                  >
                    <Download />
                    Exportar minhas notas
                  </Button>
                  <p>
                    Histórico remoto, conflitos e sincronização ponta a ponta
                    exigem o backend real.
                  </p>
                </>
              )}
            </section>
          </>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle />
          {toast}
        </div>
      )}
      {modal && (
        <div className="overlay" onClick={() => setModal(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Detalhes"
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="Fechar"
              onClick={() => setModal(null)}
            >
              <X size={24} />
            </button>
            {modal === "reset" ? (
              <>
                <h2>Restaurar dados da demonstração?</h2>
                <p>
                  Substitui somente as notas, preferências e histórico deste
                  protótipo pelos exemplos iniciais. O aplicativo nativo não
                  será alterado.
                </p>
                <Button onClick={() => setModal(null)}>Cancelar</Button>
                <Button
                  primary
                  onClick={() => {
                    setNotes(seed);
                    setReviewed(false);
                    setSettings({
                      auto: true,
                      locked: false,
                      sync: true,
                      model: "Codex",
                      jobs: true,
                    });
                    setHistory([]);
                    setSkill(["Conectar ideias", "Resumir", "Revisão semanal"]);
                    setTask(null);
                    setProfile(defaultProfile);
                    setRoutines([]);
                    setRuns([]);
                    setSelectedIds(null);
                    setView("Lista");
                    setModal(null);
                    go("hoje");
                    tell("Cenário de exemplo restaurado");
                  }}
                >
                  Restaurar demonstração
                </Button>
              </>
            ) : modal === "capture" || modal?.note ? (
              <>
                <span className="eyebrow">
                  {modal?.note ? "SUA MEMÓRIA" : "CAPTURA RÁPIDA"}
                </span>
                <h2>
                  {modal?.note
                    ? "Leia, ajuste e reutilize."
                    : "O que vale lembrar?"}
                </h2>
                {modal?.note?.snapshot && (
                  <p className="notice">
                    Versão usada na execução · somente leitura.
                  </p>
                )}
                {modal?.note?.provenance && (
                  <div className="notice">
                    <b>
                      {modal.note.provenance.kind} ·{" "}
                      {modal.note.provenance.scope}
                    </b>
                    <p>
                      Revisado em{" "}
                      {new Date(
                        modal.note.provenance.reviewedAt,
                      ).toLocaleString("pt-BR")}
                    </p>
                    <p>Execução: {modal.note.provenance.goal}</p>
                    {modal.note.provenance.sources.map((n) => (
                      <button
                        key={n.id}
                        className="textlink"
                        onClick={() =>
                          openNote({
                            id: n.id,
                            title: n.title,
                            body: n.excerpt,
                            snapshot: true,
                          })
                        }
                      >
                        {n.title}
                      </button>
                    ))}
                  </div>
                )}
                <label className="field">
                  Título
                  <input
                    autoFocus
                    value={title}
                    readOnly={!!modal?.note?.snapshot}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Opcional: dê um nome à ideia"
                  />
                </label>
                <label className="field">
                  Conteúdo
                  <textarea
                    value={draft}
                    readOnly={!!modal?.note?.snapshot}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Escreva uma ideia, fato ou contexto…"
                    rows={8}
                  />
                </label>
                {error && (
                  <>
                    <p role="alert" className="error">
                      {error}
                    </p>
                    {settings.locked && (
                      <Button
                        onClick={() => {
                          setSettings({ ...settings, locked: false });
                          setError("");
                        }}
                      >
                        Desbloquear demonstração e continuar
                      </Button>
                    )}
                  </>
                )}
                <div className="actions">
                  {!modal?.note?.snapshot && (
                    <Button primary onClick={save}>
                      Guardar
                    </Button>
                  )}
                  {modal?.note && (
                    <Button
                      onClick={() => {
                        setModal(null);
                        startTask("Explorar: " + title);
                      }}
                    >
                      Explorar com assistente
                    </Button>
                  )}
                </div>
                <p className="caption">
                  Salvo localmente neste navegador. Sem envio a serviços
                  externos.
                </p>
              </>
            ) : modal === "review" ? (
              <>
                <span className="eyebrow">DECISÃO PREPARADA</span>
                <h2>Atualizar o prazo do projeto?</h2>
                <p>
                  Conflito demonstrativo entre duas fontes. Nada será alterado
                  sem sua decisão.
                </p>
                <div className="diff">
                  <div>
                    <small>ATUAL · Planejamento.md</small>
                    <h3>18 de novembro</h3>
                  </div>
                  <ArrowRight />
                  <div>
                    <small>PROPOSTO · Reunião de segunda.md</small>
                    <h3>25 de novembro</h3>
                  </div>
                </div>
                <p>
                  A alteração será acrescentada à nota de estratégia com a
                  referência da reunião.
                </p>
                <div className="actions">
                  <Button primary onClick={applyReview}>
                    Aplicar alteração
                  </Button>
                  <Button
                    onClick={() => {
                      setReviewed(true);
                      setModal(null);
                      log("Proposta descartada; prazo original mantido");
                    }}
                  >
                    Manter prazo atual
                  </Button>
                </div>
              </>
            ) : modal === "history" ? (
              <>
                <h2>Histórico de atividades</h2>
                <p>Registro das ações realizadas neste protótipo.</p>
                {history.length ? (
                  history.map((h, i) => (
                    <div className="setting" key={i}>
                      <span>{h.text}</span>
                      <small>{h.time}</small>
                    </div>
                  ))
                ) : (
                  <p>Nenhuma ação registrada ainda.</p>
                )}
                {reviewed && (
                  <Button
                    onClick={() => {
                      setReviewed(false);
                      setNotes((ns) =>
                        ns.map((n) =>
                          n.id === "1"
                            ? {
                                ...n,
                                body: n.body.split(
                                  "\n\nAtualização revisada:",
                                )[0],
                              }
                            : n,
                        ),
                      );
                      log("Revisão de prazo desfeita");
                      tell("Decisão desfeita");
                    }}
                  >
                    <ArrowCounterClockwise />
                    Desfazer revisão do prazo
                  </Button>
                )}
              </>
            ) : modal === "unlock" ? (
              <>
                <Lock size={36} />
                <h2>Memória bloqueada</h2>
                <p>
                  No app real, este passo solicita a chave local. Aqui, você
                  pode testar o desbloqueio sem fornecer credenciais.
                </p>
                <Button
                  primary
                  onClick={() => {
                    setSettings({ ...settings, locked: false });
                    setModal(null);
                    tell("Memória demonstrativa desbloqueada");
                  }}
                >
                  Desbloquear demonstração
                </Button>
              </>
            ) : modal === "import" ? (
              <>
                <h2>Traga seu conhecimento</h2>
                <p>
                  Importe um arquivo Markdown ou texto. A organização automática
                  é uma proposta; aqui o conteúdo é preservado como nota.
                </p>
                <label className="field">
                  Arquivo .md ou .txt
                  <input
                    type="file"
                    accept=".md,.txt"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 1000000) {
                        tell("Escolha um arquivo de até 1 MB");
                        return;
                      }
                      setTitle(file.name.replace(/\.(md|txt)$/, ""));
                      setDraft(await file.text());
                      setModal("capture");
                    }}
                  />
                </label>
              </>
            ) : modal === "card" ? (
              <>
                <span className="eyebrow">REVISÃO ESPAÇADA</span>
                <h2>Tornar o conhecimento útil no momento certo.</h2>
                <p>
                  Prioridades: captura simples, respostas com fontes e revisão
                  de alterações.
                </p>
                <div className="actions">
                  {["Rever", "Difícil", "Bom", "Fácil"].map((s) => (
                    <Button
                      key={s}
                      onClick={() => {
                        log("Cartão revisado: " + s);
                        setModal(null);
                        tell("Resposta registrada no histórico demonstrativo");
                      }}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </>
            ) : modal?.connection ? (
              <>
                <h2>Conectar {modal.connection}</h2>
                <p>
                  O app pode preparar a configuração e verificar a conexão.
                  Nesta demonstração, nenhuma credencial é solicitada.
                </p>
                <ol>
                  <li>Selecionar agente e escopo de leitura.</li>
                  <li>Preparar configuração de memória.</li>
                  <li>Testar acesso e apresentar resultado.</li>
                </ol>
                <Button
                  primary
                  onClick={() => {
                    tell(
                      "Teste demonstrativo concluído. Nenhuma conexão real criada.",
                    );
                    log("Teste simulado: " + modal.connection);
                  }}
                >
                  Simular teste
                </Button>
                <details>
                  <summary>Configuração avançada e prompt</summary>
                  <pre>
                    Escopo: memória pessoal\nAcesso: leitura\nEscritas: sujeitas
                    à política\nTransporte: configurar no aplicativo real
                  </pre>
                </details>
              </>
            ) : modal === "automation" ? (
              <>
                <h2>Qual resultado deve se repetir?</h2>
                <label className="field">
                  Objetivo
                  <input
                    autoFocus
                    value={draft}
                    readOnly={!!modal?.note?.snapshot}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Preparar minha revisão semanal"
                  />
                </label>
                <p>
                  Exemplo: semanal, segunda-feira às 9h. Sem gastos ou
                  publicação. Nesta versão a rotina não é agendada.
                </p>
                <Button
                  primary
                  disabled={!draft.trim()}
                  onClick={() => {
                    setModal(null);
                    startTask(draft);
                  }}
                >
                  Preparar execução demonstrativa
                </Button>
              </>
            ) : modal === "security" ? (
              <>
                <h2>Controles de segurança preservados</h2>
                <p>
                  Criptografar/descriptografar o cofre, gerenciar chave, ocultar
                  caminhos, verificar exposição e revisar recomendações.
                </p>
                <p>
                  Essas operações precisam do aplicativo nativo. O protótipo
                  mantém sua localização e explica seu efeito, sem fingir
                  criptografia.
                </p>
              </>
            ) : (
              <>
                <h2>Modelos e runtimes</h2>
                <p>
                  Gerenciamento dos arquivos locais, instalação e seleção de
                  runtime permanecem nesta área. Downloads reais não são
                  executados no protótipo.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Setting({ title, description, checked, onChange }) {
  return (
    <div className="setting">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <button
        className={"toggle " + (checked ? "on" : "")}
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={onChange}
      >
        <span />
      </button>
    </div>
  );
}

function KnowledgeGraph({ notes, onOpen }) {
  const container = useRef(null);
  const callback = useRef(onOpen);
  callback.current = onOpen;
  useEffect(() => {
    const subset = notes.slice(0, 7);
    const cy = cytoscape({
      container: container.current,
      elements: [
        ...subset.map((n) => ({ data: { id: n.id, label: n.title } })),
        ...subset.map((n, i) => ({
          data: {
            id: "e" + n.id,
            source: n.id,
            target: subset[(i + 1) % subset.length].id,
          },
        })),
      ],
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#133643",
            "border-color": "#76e7ef",
            "border-width": 2,
            width: 36,
            height: 36,
            label: "data(label)",
            color: "#c5e9ef",
            "font-size": 12,
            "text-valign": "bottom",
            "text-margin-y": 10,
            "text-wrap": "wrap",
            "text-max-width": 130,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#357b89",
            "curve-style": "bezier",
          },
        },
      ],
      layout: { name: "circle", padding: 70 },
      minZoom: 0.5,
      maxZoom: 2,
    });
    cy.on("tap", "node", (e) =>
      callback.current(subset.find((n) => n.id === e.target.id())),
    );
    const observer = new ResizeObserver(() => cy.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      cy.destroy();
    };
  }, [notes]);
  return (
    <div
      className="knowledgegraph"
      ref={container}
      role="img"
      aria-label="Grafo de conexões demonstrativas. As mesmas notas e relações estão disponíveis na lista abaixo."
    />
  );
}
