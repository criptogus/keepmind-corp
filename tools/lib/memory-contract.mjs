// Shared, dependency-free interpretation of the vault's dated fact document.
const origins = new Set(['user', 'sleep', 'chat', 'mcp', 'webhook', 'agent', 'legacy'])
export function readFactDocument(raw) {
  const text = raw.replace(/\r\n/g, '\n')
  if (!/^## (Ativos|Arquivo|Propostas|Legado)\s*$/m.test(text)) return { legacy: text.trim(), facts: [] }
  const section = name => (text.split(new RegExp(`^## ${name}\\s*$`, 'm'))[1] ?? '').split(/^## /m)[0] ?? ''
  const parse = (name, status) => section(name).split(/^### /m).slice(1).map(part => {
    const nl = part.indexOf('\n')
    const id = (nl < 0 ? part : part.slice(0, nl)).trim()
    const body = nl < 0 ? '' : part.slice(nl + 1)
    const field = name => body.match(new RegExp(`^- ${name}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim() ?? ''
    const origin = field('origin').toLowerCase()
    return { id, status, since: field('since'), until: field('until'), source: field('source'), origin: origins.has(origin) ? origin : 'legacy', supersedes: field('supersedes'), supersededBy: field('superseded-by'), text: body.replace(/^- (since|until|source|origin|supersedes|superseded-by):.*$/gm, '').trim() }
  }).filter(f => f.id.startsWith('f-') || f.id.startsWith('p-'))
  return { legacy: section('Legado').trim(), facts: [...parse('Ativos', 'active'), ...parse('Arquivo', 'archived'), ...parse('Propostas', 'proposal')] }
}
function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const date = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === day
}
function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function current(f) {
  const day = today()
  return f.status === 'active' && !f.supersededBy && validDay(f.since) && f.since <= day && (!f.until || (validDay(f.until) && f.until > day))
}
export function selectFacts(raw, options = {}) {
  const mode = options.mode ?? 'current'
  if (!['current', 'history', 'asOf'].includes(mode)) throw new Error('Invalid memory selection mode')
  if (mode === 'asOf' && !validDay(options.asOf ?? '')) throw new Error('asOf requires YYYY-MM-DD')
  const doc = readFactDocument(raw)
  const facts = doc.facts.filter(f => mode === 'history' ? true : mode === 'current' ? current(f) : f.status !== 'proposal' && validDay(f.since) && (!f.until || validDay(f.until)) && f.since <= options.asOf && (!f.until || f.until > options.asOf))
  return { facts, legacy: mode === 'asOf' ? '' : doc.legacy }
}
export function formatFactSelection(raw, options = {}) {
  const { facts, legacy } = selectFacts(raw, options)
  const mode = options.mode ?? 'current'
  const lines = facts.map(f => `[${mode === 'asOf' ? `historical as of ${options.asOf}` : current(f) ? 'canonical current fact' : f.status === 'active' ? 'historical or invalid-date record, not established as current' : f.status === 'proposal' ? 'proposal, unconfirmed' : 'historical archived fact'}; id: ${f.id}; since: ${f.since || 'unknown'}; until: ${f.until || 'open'}; origin: ${f.origin}; source: ${f.source || 'unknown'}${f.supersedes ? `; supersedes: ${f.supersedes}` : ''}${f.supersededBy ? `; superseded-by: ${f.supersededBy}` : ''}]\n${f.text}`)
  if (legacy) lines.push(`[legacy, undated and unverified; not a confirmed current fact]\n${legacy}`)
  return lines.join('\n\n')
}
export function labelMemorySource(path) {
  const relative = path.replace(/^spaces\/[^/]+\//, '')
  return /^(short-term|daily|inbox|meetings|agents|sleep|review|summaries|medium-term)\//.test(relative)
    ? 'historical source, unverified; statements may no longer be current'
    : 'source material, unverified; canonical current facts take precedence'
}
