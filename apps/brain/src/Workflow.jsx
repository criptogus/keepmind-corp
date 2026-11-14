import React, { useState } from "react";
import {
  CheckCircle,
  ArrowRight,
  ArrowCounterClockwise,
  FileText,
  Lightning,
} from "@phosphor-icons/react";
import {
  sourceNotes,
  resultText,
  makeLearning,
  makeRoutine,
} from "./workflow.js";
export function Cycle({ task }) {
  const step =
    task.status !== "done"
      ? 1
      : task.routineIdCreated
        ? 4
        : task.learningState === "applied" || task.learningState === "discarded"
          ? 3
          : 2;
  return (
    <ol className="cycle" aria-label="Etapas do ciclo">
      {[
        "Objetivo",
        "Execução",
        "Resultado",
        "Aprendizado",
        "Skill / rotina",
      ].map((s, i) => (
        <li
          className={i <= step ? "reached" : ""}
          key={s}
          aria-current={i === step ? "step" : undefined}
        >
          <span>{i < step ? <CheckCircle size={15} /> : i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}
export function Outcome({
  task,
  setTask,
  notes,
  setNotes,
  routines,
  setRoutines,
  openNote,
  log,
  tell,
  locked,
  onRoutines,
}) {
  const [name, setName] = useState(task.skill?.name || task.goal),
    [frequency, setFrequency] = useState("Manual"),
    [review, setReview] = useState(false),
    [routineForm, setRoutineForm] = useState(false);
  const sources = sourceNotes(task);
  const applied = task.learningState === "applied",
    settled = applied || task.learningState === "discarded";
  const canWrite = () => {
    if (locked) {
      tell("Desbloqueie a memória antes de registrar alterações.");
      return false;
    }
    return true;
  };
  const apply = () => {
    if (!canWrite() || !task.learningText.trim() || applied) return;
    const note = makeLearning(task);
    setNotes((ns) => [note, ...ns.filter((n) => n.id !== note.id)]);
    setTask({ ...task, learningState: "applied", appliedBody: note.body });
    log("Aprendizado revisado e registrado: " + task.goal);
    setReview(false);
    tell("Aprendizado registrado com fontes e data de revisão");
  };
  return (
    <div className="answer">
      <div className="sectionhead">
        <h3>Resultado com evidências</h3>
        <span className="tag">{sources.length} FONTES</span>
      </div>
      <p className="caption">
        Seleção congelada no início da tarefa. Síntese demonstrativa, sem
        chamada a IA.
      </p>
      {sources.length ? (
        sources.map((n, i) => (
          <div className="evidencequote" key={n.id}>
            <p>{n.body.split("\n").filter(Boolean).slice(0, 2).join(" ")}</p>
            <button
              className="textlink"
              onClick={() =>
                openNote({
                  ...n,
                  title: n.title + " · versão usada na tarefa",
                  snapshot: true,
                })
              }
            >
              <FileText size={15} />[{i + 1}] {n.title}
            </button>
          </div>
        ))
      ) : (
        <div className="notice">
          Nenhuma fonte selecionada. Adicione contexto antes de gerar
          aprendizados.
        </div>
      )}
      <div className="actions">
        <button
          disabled={task.saved || !sources.length}
          onClick={() => {
            if (!canWrite()) return;
            setNotes((ns) => [
              {
                id: "result-" + task.id,
                title: task.goal,
                body: resultText(task),
                type: "Nota",
                date: "Hoje",
              },
              ...ns,
            ]);
            setTask({ ...task, saved: true });
            log("Resultado guardado: " + task.goal);
          }}
        >
          {task.saved ? "Resultado guardado" : "Guardar síntese"}
        </button>
        <span className="caption">
          Custo: sem chamada externa · qualidade não avaliada por modelo
        </span>
      </div>
      <section className="learningbox">
        <span className="eyebrow">O QUE VALE LEVAR PARA A PRÓXIMA VEZ</span>
        <h2>
          {applied
            ? "Aprendizado incorporado"
            : task.learningState === "discarded"
              ? "Proposta descartada"
              : "Aprendizado preparado para revisão"}
        </h2>
        <p>
          Uma proposta de procedimento, não um novo fato inferido. Você pode
          corrigir o conteúdo e o escopo.
        </p>
        {settled ? (
          <>
            <p className="learnedtext">{task.learningText}</p>
            <div className="actions">
              {applied && (
                <button
                  onClick={() =>
                    openNote(
                      notes.find((n) => n.id === "learning-" + task.id) ||
                        makeLearning(task),
                    )
                  }
                >
                  Ver na memória
                </button>
              )}
              <button
                onClick={() => {
                  if (!canWrite()) return;
                  const n = notes.find((n) => n.id === "learning-" + task.id);
                  if (n && n.body !== task.appliedBody) {
                    tell(
                      "O aprendizado foi editado. Revise a nota antes de desfazer.",
                    );
                    return;
                  }
                  setNotes((ns) =>
                    ns.filter((n) => n.id !== "learning-" + task.id),
                  );
                  setTask({ ...task, learningState: "pending" });
                  log("Registro de aprendizado desfeito: " + task.goal);
                }}
              >
                <ArrowCounterClockwise />{" "}
                {applied ? "Desfazer aprendizado" : "Reabrir proposta"}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="field">
              Aprendizado proposto
              <textarea
                rows={3}
                value={task.learningText}
                onChange={(e) =>
                  setTask({ ...task, learningText: e.target.value })
                }
              />
            </label>
            <div className="formgrid">
              <label className="field">
                Tipo
                <select
                  value={task.learningKind}
                  onChange={(e) =>
                    setTask({ ...task, learningKind: e.target.value })
                  }
                >
                  <option>Procedimento</option>
                  <option>Preferência</option>
                  <option>Decisão</option>
                  <option>Hipótese</option>
                </select>
              </label>
              <label className="field">
                Escopo
                <select
                  value={task.scope}
                  onChange={(e) => setTask({ ...task, scope: e.target.value })}
                >
                  <option>Pessoal</option>
                  <option>Projeto</option>
                  <option>Empresa</option>
                </select>
              </label>
            </div>
            {review ? (
              <div className="reviewdiff">
                <div>
                  <small>ANTES</small>
                  <p>Nenhum aprendizado registrado por esta execução.</p>
                </div>
                <div>
                  <small>
                    DEPOIS · {task.scope} · {task.learningKind}
                  </small>
                  <p>{task.learningText}</p>
                  <small>
                    {sources.length} fontes · data de revisão registrada ao
                    aplicar
                  </small>
                </div>
                <div className="actions">
                  <button className="primary" onClick={apply}>
                    Confirmar aprendizado
                  </button>
                  <button onClick={() => setReview(false)}>
                    Continuar editando
                  </button>
                </div>
              </div>
            ) : (
              <div className="actions">
                <button
                  className="primary"
                  disabled={!sources.length || !task.learningText.trim()}
                  onClick={() => setReview(true)}
                >
                  Revisar antes de guardar
                </button>
                <button
                  onClick={() => {
                    setTask({ ...task, learningState: "discarded" });
                    log("Proposta de aprendizado descartada");
                  }}
                >
                  Descartar proposta
                </button>
              </div>
            )}
          </>
        )}
      </section>
      <section className="routinebox">
        <span className="eyebrow">TRANSFORME O RESULTADO EM PROCESSO</span>
        <h2>
          {task.routineIdCreated
            ? "Skill e rotina prontas para reutilizar"
            : "Transforme aprendizado em uma skill."}
        </h2>
        <p>
          Preserve o objetivo, as fontes, o procedimento e os critérios de
          qualidade.
        </p>
        {task.routineIdCreated ? (
          <button className="primary" onClick={onRoutines}>
            Abrir minhas rotinas <ArrowRight />
          </button>
        ) : routineForm ? (
          <>
            {task.routineId && (
              <div className="notice">
                Evolução proposta: v{task.skill?.version || 1} → v
                {(task.skill?.version || 1) + 1}. A nova versão mantém o
                objetivo e incorpora o aprendizado revisado.
              </div>
            )}
            <label className="field">
              Nome da rotina
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              Frequência desejada
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                <option>Manual</option>
                <option>Diária</option>
                <option>Semanal</option>
              </select>
            </label>
            <div className="notice">
              Frequência salva como preferência. Este protótipo não agenda
              execuções em segundo plano.
            </div>
            <p>
              Limites: consultar e preparar. Sem gastos, publicação ou exclusão.
              Alterações na memória exigem revisão.
            </p>
            <ul>
              <li>Consultar as fontes selecionadas</li>
              <li>Preparar resultado com referências</li>
              <li>Propor aprendizado para revisão</li>
            </ul>
            <button
              className="primary"
              disabled={!name.trim()}
              onClick={() => {
                if (!canWrite()) return;
                const r = makeRoutine(task, name, frequency);
                if (task.routineId) {
                  r.id = task.routineId;
                  r.version =
                    (routines.find((x) => x.id === task.routineId)?.version ||
                      1) + 1;
                  r.versions = [
                    ...(routines.find((x) => x.id === task.routineId)
                      ?.versions || []),
                    {
                      version: r.version,
                      goal: task.goal,
                      date: new Date().toISOString(),
                      executor: task.executor,
                      steps: [...r.steps],
                      checks: [...r.checks],
                      sourceIds: [...r.sourceIds],
                    },
                  ];
                  setRoutines((rs) => rs.map((x) => (x.id === r.id ? r : x)));
                } else {
                  setRoutines((rs) => [r, ...rs]);
                }
                setTask({ ...task, routineIdCreated: r.id });
                log("Rotina criada: " + r.name);
                tell("Skill e rotina disponíveis em Configurações");
              }}
            >
              Confirmar skill e rotina
            </button>
          </>
        ) : (
          <button
            disabled={!settled || !sources.length}
            onClick={() => setRoutineForm(true)}
          >
            <Lightning />
            Criar skill e rotina
          </button>
        )}
        {!settled && (
          <p className="caption">
            Revise ou descarte a proposta de aprendizado para concluir o ciclo.
          </p>
        )}
      </section>
    </div>
  );
}
export function Profile({ profile, setProfile, notes }) {
  const [draft, setDraft] = useState(profile),
    [saved, setSaved] = useState(false);
  return (
    <section className="panel">
      <span className="eyebrow">CONTEXTO QUE ORIENTA O ASSISTENTE</span>
      <h2>Como você pensa, escreve e decide.</h2>
      <p>
        Preferências explícitas, não inferidas automaticamente. Escopos
        organizam o contexto; não representam isolamento de acesso neste
        protótipo.
      </p>
      {[
        ["goals", "Objetivos"],
        ["voice", "Estilo de comunicação"],
        ["principles", "Critérios de decisão"],
        ["source", "Origem das preferências"],
      ].map(([key, label]) => (
        <label className="field" key={key}>
          {label}
          <textarea
            rows={2}
            value={draft[key]}
            onChange={(e) => {
              setDraft({ ...draft, [key]: e.target.value });
              setSaved(false);
            }}
          />
        </label>
      ))}
      <label className="field">
        Escopo padrão
        <select
          value={draft.scope}
          onChange={(e) => {
            setDraft({ ...draft, scope: e.target.value });
            setSaved(false);
          }}
        >
          <option>Pessoal</option>
          <option>Projeto</option>
          <option>Empresa</option>
        </select>
      </label>
      <button
        className="primary"
        onClick={() => {
          const p = { ...draft, reviewedAt: new Date().toISOString() };
          setProfile(p);
          setDraft(p);
          setSaved(true);
        }}
      >
        Salvar contexto revisado
      </button>
      <p role="status" className="caption">
        {saved
          ? "Contexto salvo. Será aplicado às próximas tarefas."
          : profile.reviewedAt
            ? "Última revisão: " +
              new Date(profile.reviewedAt).toLocaleString("pt-BR")
            : "Contexto de exemplo ainda não revisado."}
      </p>
    </section>
  );
}
export function Routines({ routines, setRoutines, onRun, runs, enabled }) {
  const [editing, setEditing] = useState(null);
  return (
    <section className="customroutines">
      <span className="eyebrow">CRIADAS A PARTIR DO SEU TRABALHO</span>
      <h2>Minhas rotinas</h2>
      {!routines.length ? (
        <p>
          Conclua uma tarefa no Assistente e transforme o processo em uma
          rotina.
        </p>
      ) : (
        routines.map((r) => (
          <article className="routinecard" key={r.id}>
            <div className="sectionhead">
              <div>
                <h3>{r.name}</h3>
                <small>
                  {r.scope} · {r.frequency} ·{" "}
                  {r.enabled ? "Disponível" : "Pausada"} · sem agendamento real
                </small>
              </div>
              <span className="tag">
                {runs.filter((run) => run.routineId === r.id).length} RESULTADOS
              </span>
            </div>
            <p>{r.goal}</p>
            <details>
              <summary>Fontes, etapas e limites</summary>
              <p>
                {r.sourceIds.length} referências vinculadas. Usaremos a versão
                atual na próxima execução.
              </p>
              <ol>
                {r.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <p>{r.limits}</p>
              <p>Verificações: {r.checks.join(" · ")}</p>
            </details>
            {editing === r.id && (
              <div className="formgrid">
                <label className="field">
                  Nome da rotina
                  <input
                    value={r.name}
                    onChange={(e) =>
                      setRoutines((rs) =>
                        rs.map((x) =>
                          x.id === r.id ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label className="field">
                  Frequência desejada
                  <select
                    value={r.frequency}
                    onChange={(e) =>
                      setRoutines((rs) =>
                        rs.map((x) =>
                          x.id === r.id
                            ? { ...x, frequency: e.target.value }
                            : x,
                        ),
                      )
                    }
                  >
                    <option>Manual</option>
                    <option>Diária</option>
                    <option>Semanal</option>
                  </select>
                </label>
              </div>
            )}
            <div className="actions">
              <button
                className="primary"
                disabled={!r.enabled || !enabled || !r.name.trim()}
                onClick={() => onRun(r)}
              >
                Executar rotina
              </button>
              <button
                onClick={() => setEditing(editing === r.id ? null : r.id)}
              >
                {editing === r.id ? "Concluir edição" : "Editar rotina"}
              </button>
              <button
                onClick={() =>
                  setRoutines((rs) =>
                    rs.map((x) =>
                      x.id === r.id ? { ...x, enabled: !x.enabled } : x,
                    ),
                  )
                }
              >
                {r.enabled ? "Pausar rotina" : "Reativar rotina"}
              </button>
            </div>
          </article>
        ))
      )}
    </section>
  );
}
