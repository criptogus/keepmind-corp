export const defaultProfile = {
  scope: "Pessoal",
  goals: "Transformar conhecimento em decisões úteis.",
  voice: "Português claro, direto e com referências.",
  principles:
    "Preservar fontes; distinguir fatos de hipóteses; revisar mudanças importantes.",
  source: "Preferências de exemplo — revisar antes de usar",
  reviewedAt: null,
};
export function createTask(
  goal,
  notes,
  profile,
  auto = true,
  ids = null,
  routineId = null,
) {
  const selected = ids
    ? notes.filter((n) => ids.includes(n.id))
    : notes.filter((n) => n.type !== "Aprendizado").slice(0, 3);
  return {
    id: crypto.randomUUID(),
    goal: goal.trim(),
    step: 0,
    status: auto ? "running" : "planned",
    sources: selected.map((n) => ({ ...n })),
    profile: { ...profile },
    routineId,
    startedAt: new Date().toISOString(),
    saved: false,
    learningState: "pending",
    learningText: `Para “${goal.trim()}”, consultar as fontes selecionadas, separar evidências de hipóteses e revisar alterações antes de registrá-las.`,
    learningKind: "Procedimento",
    scope: profile.scope,
  };
}
export function sourceNotes(task) {
  return (task?.sources || []).filter((s) => typeof s === "object" && s.id);
}
export function resultText(task) {
  return sourceNotes(task)
    .map(
      (n, i) =>
        `[${i + 1}] ${n.title}\n${n.body.split("\n").filter(Boolean).slice(0, 2).join("\n")}`,
    )
    .join("\n\n");
}
export function makeLearning(task) {
  return {
    id: "learning-" + task.id,
    title: "Aprendizado: " + task.goal,
    body: task.learningText,
    type: "Aprendizado",
    date: "Hoje",
    provenance: {
      taskId: task.id,
      goal: task.goal,
      scope: task.scope,
      kind: task.learningKind,
      sources: sourceNotes(task).map((n) => ({
        id: n.id,
        title: n.title,
        excerpt: n.body,
      })),
      reviewedAt: new Date().toISOString(),
    },
  };
}
export function makeRoutine(task, name, frequency) {
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    version: 1,
    executor: task.executor,
    versions: [
      { version: 1, date: new Date().toISOString(), executor: task.executor },
    ],
    goal: task.goal,
    frequency,
    scope: task.scope,
    sourceIds: [
      ...sourceNotes(task).map((n) => n.id),
      ...(task.learningState === "applied" ? ["learning-" + task.id] : []),
    ],
    steps: [
      ...(task.learningState === "applied" ? [task.learningText] : []),
      "Consultar as fontes selecionadas",
      "Preparar resultado com referências",
      "Propor aprendizado para revisão",
    ],
    checks: [
      "Referências presentes",
      "Hipóteses identificadas",
      "Alterações revisadas",
    ],
    limits: "Somente leitura e preparação. Sem gastos, publicação ou exclusão.",
    enabled: true,
    createdFrom: task.id,
    createdAt: new Date().toISOString(),
  };
}
