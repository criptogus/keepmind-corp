/** Human labels are presentation only; original paths remain the source identity. */
export function sourceLabel(path: string, title?: string) {
  if (title?.trim() && title !== path && !title.includes('/')) return title
  const name = path.split('/').at(-1) ?? path
  const known: Record<string, string> = { 'facts.md': 'Fatos e histórico', 'policy.md': 'Política da memória' }
  return known[name] ?? name.replace(/\.md$/i, '').replace(/[-_]/g, ' ')
}
export function updatedLabel(value?: string) {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? `Atualizado em ${date.toLocaleString('pt-BR')}` : 'Data de atualização não informada'
}
