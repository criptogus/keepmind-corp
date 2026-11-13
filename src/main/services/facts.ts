// Dated facts. Active text is what the prompt may trust. Proposals wait
// for the person. Archive keeps what used to be true, with an end date.

import { readFactDocument, selectFacts, formatFactSelection } from '../../../tools/lib/memory-contract.mjs'
export type { FactOrigin, FactStatus, Fact, FactDoc } from '../../../tools/lib/memory-contract.mjs'
import type { FactOrigin, Fact, FactDoc } from '../../../tools/lib/memory-contract.mjs'

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export function localDay(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function factId(prefix: 'f' | 'p'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

export const readFacts = readFactDocument

function block(f: Fact): string {
  return [
    `### ${f.id}`,
    `- since: ${f.since}`,
    `- until: ${f.until}`,
    `- source: ${f.source}`,
    `- origin: ${f.origin}`,
    `- supersedes: ${f.supersedes}`,
    `- superseded-by: ${f.supersededBy}`,
    '',
    f.text.trim(),
    ''
  ].join('\n')
}

export function renderFacts(doc: FactDoc): string {
  const chunks = [
    '# Fatos',
    '',
    '## Legado',
    '',
    doc.legacy.trim(),
    '',
    '## Ativos',
    '',
    ...doc.facts.filter(f => f.status === 'active').map(block),
    '## Arquivo',
    '',
    ...doc.facts.filter(f => f.status === 'archived').map(block),
    '## Propostas',
    '',
    ...doc.facts.filter(f => f.status === 'proposal').map(block)
  ]
  return `${chunks.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

export function activeForPrompt(raw: string): string {
  return formatFactSelection(raw)
}

export function factsAsOf(raw: string, day: string): Fact[] {
  return selectFacts(raw, { mode: 'asOf', asOf: day }).facts
}

function ensure(raw: string): FactDoc {
  return readFacts(raw)
}

function pushFact(doc: FactDoc, fact: Fact) {
  doc.facts.push(fact)
}

export function addActive(raw: string, text: string, source: string, origin: FactOrigin, supersedes = ''): { raw: string; id: string } {
  const doc = ensure(raw)
  const today = localDay()
  const id = factId('f')
  if (supersedes) {
    const old = doc.facts.find(f => f.id === supersedes && f.status === 'active')
    if (old) {
      old.status = 'archived'
      old.until = today
      old.supersededBy = id
    }
  }
  pushFact(doc, {
    id, status: 'active', since: today, until: '', source, origin, supersedes, supersededBy: '', text: text.trim()
  })
  return { raw: renderFacts(doc), id }
}

export function addProposal(raw: string, text: string, source: string, origin: FactOrigin, supersedes = ''): { raw: string; id: string } {
  const doc = ensure(raw)
  const id = factId('p')
  pushFact(doc, {
    id, status: 'proposal', since: localDay(), until: '', source, origin, supersedes, supersededBy: '', text: text.trim()
  })
  return { raw: renderFacts(doc), id }
}

export function acceptProposal(raw: string, id: string): { raw: string; ok: boolean; text: string } {
  const doc = ensure(raw)
  const item = doc.facts.find(f => f.id === id && f.status === 'proposal')
  if (!item) return { raw, ok: false, text: '' }
  const today = localDay()
  item.status = 'active'
  item.id = item.id.startsWith('p-') ? `f-${item.id.slice(2)}` : item.id
  item.since = item.since || today
  if (item.supersedes) {
    const old = doc.facts.find(f => f.id === item.supersedes && f.status === 'active')
    if (old) {
      old.status = 'archived'
      old.until = today
      old.supersededBy = item.id
    }
  }
  return { raw: renderFacts(doc), ok: true, text: item.text }
}

export function discardProposal(raw: string, id: string): { raw: string; ok: boolean } {
  const doc = ensure(raw)
  const before = doc.facts.length
  doc.facts = doc.facts.filter(f => !(f.id === id && f.status === 'proposal'))
  return { raw: renderFacts(doc), ok: doc.facts.length !== before }
}

export function proposalsOf(raw: string): Fact[] {
  return readFacts(raw).facts.filter(f => f.status === 'proposal')
}

export function factById(raw: string, id: string): Fact | null {
  return readFacts(raw).facts.find(f => f.id === id) ?? null
}

// Dedupe only the undated legacy bullets. Structured blocks stay whole.
export function compactLegacy(raw: string): string {
  const doc = readFacts(raw)
  if (!doc.legacy.trim() && doc.facts.length === 0) return raw
  const seen = new Set<string>()
  const lines: string[] = []
  for (const line of doc.legacy.split('\n')) {
    const key = line.trim().toLowerCase()
    if (key.startsWith('- ') && seen.has(key)) continue
    if (key.startsWith('- ')) seen.add(key)
    lines.push(line)
  }
  const legacy = lines.join('\n').trim()
  if (legacy === doc.legacy.trim() && /^## Ativos/m.test(raw)) return raw
  doc.legacy = legacy
  return renderFacts(doc)
}

function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

export function parseAsOf(query: string, now = new Date()): string | null {
  const folded = fold(query)
  const temporal = /o que valia|valia em|valiam|na epoca|as of|no dia|na data/.test(folded)
  const iso = query.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (iso && temporal) return iso[1]
  const br = query.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/)
  if (br && temporal) {
    return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`
  }
  const month = folded.match(new RegExp(`\\b(${MONTHS.join('|')})(?:\\s+de\\s+(20\\d{2}))?`))
  if (!month || !temporal) return null
  const m = MONTHS.indexOf(month[1]) + 1
  let year = month[2] ? Number(month[2]) : now.getFullYear()
  if (!month[2] && m > now.getMonth() + 1) year -= 1
  const last = new Date(year, m, 0).getDate()
  return `${year}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

export function monthLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const name = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][(m || 1) - 1]
  return `${d} de ${name} de ${y}`
}
