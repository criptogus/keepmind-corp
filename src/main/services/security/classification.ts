export const classes = ['public', 'internal', 'sensitive', 'secret'] as const
export type Classification = typeof classes[number]
export interface ItemPolicy { class: Classification; space: string; override?: Classification }
export const restricted = (c: Classification) => classes.indexOf(c) >= 2
export const maxClass = (...cs: Classification[]): Classification => classes[Math.max(...cs.map(c => classes.indexOf(c)))]
const detectors: { kind: string; secret: boolean; pattern: RegExp }[] = [
  { kind: 'private-key', secret: true, pattern: /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?(?:-----END (?:[A-Z ]*PRIVATE KEY)-----|$)/g },
  { kind: 'token', secret: true, pattern: /\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|xox[a-z]-[A-Za-z0-9-]{8,}|AKIA[A-Z0-9]{16})\b/g },
  { kind: 'jwt', secret: true, pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  { kind: 'cnpj', secret: false, pattern: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g },
  { kind: 'cpf', secret: false, pattern: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g },
  { kind: 'email', secret: false, pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: 'phone-digits', secret: false, pattern: /(?:\+\d{8,15}\b|\b\d{10,15}\b)/g },
  { kind: 'phone', secret: false, pattern: /(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,3}\)[ .-]?|\b\d{2,3}[ .-])\d{4,5}[ .-]?\d{4}\b/g }
]
// A numeric UUID segment is an identifier, not a phone or document number.
// Keep the original text for all secret detectors and for matches outside UUIDs.
const uuidRanges = (text: string): Array<[number, number]> => [...text.matchAll(/(?<![a-f0-9])[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?![a-f0-9])/gi)].map(m => [m.index!, m.index! + m[0].length])
const insideUuid = (start: number, length: number, ranges: Array<[number, number]>) => ranges.some(([a, b]) => start >= a && start + length <= b)
export function detections(text: string) {
  const ranges = uuidRanges(text)
  return detectors.flatMap(d => [...text.matchAll(new RegExp(d.pattern))].filter(m => d.secret || !insideUuid(m.index!, m[0].length, ranges)).map(m => ({ kind: d.kind, secret: d.secret, value: m[0] })))
}
export function classify(text: string): Classification {
  const hits = detections(text)
  return hits.some(h => h.secret) ? 'secret' : hits.length ? 'sensitive' : 'internal'
}
export function policy(text: string, fallbackSpace = 'personal'): ItemPolicy {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? ''
  const field = (name: string) => fm.match(new RegExp(`^${name}:\\s*([^\\r\\n]+)`, 'm'))?.[1]?.trim()
  const validClass = (s?: string): Classification | undefined => classes.includes(s as Classification) ? s as Classification : undefined
  const override = validClass(field('class_override'))
  // A downgrade never disables detector-driven protection.
  const detected = classify(text)
  const c = maxClass(restricted(detected) ? detected : 'public', override ?? validClass(field('class')) ?? 'internal')
  const space = field('space') ?? fallbackSpace
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(space)) throw new Error('Invalid space')
  return { class: c, space, override }
}
export function frontmatter(text: string, p: ItemPolicy): string {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  const rest = (match?.[1] ?? '').split('\n').filter(l => !/^(class|space|class_override):/.test(l)).filter(Boolean)
  return `---\nclass: ${p.class}\nspace: ${p.space}\n${p.override ? `class_override: ${p.override}\n` : ''}${rest.length ? rest.join('\n') + '\n' : ''}---\n${match ? text.slice(match[0].length) : text}`
}
export function redact(text: string): { text: string; count: number } {
  let count = 0
  for (const d of detectors) {
    const ranges = uuidRanges(text)
    text = text.replace(new RegExp(d.pattern), (match, offset: number) => { if (!d.secret && insideUuid(offset, match.length, ranges)) return match; count++; return `[REDACTED:${d.kind}]` })
  }
  return { text, count }
}
export function allowedSpace(space: string, current = 'personal', grants: readonly string[] = []) { return space === current || grants.includes(space) }
