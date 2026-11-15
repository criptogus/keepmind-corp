type Read = (path: string, body?: unknown) => Promise<any>
type Entry = { path: string; title?: string }
const profile = (p: string) => /^(People|Companies)\/(?:[^/]+\/)*[^/]+\.md$/i.test(p) && !/\/(?:index(?:\.generated)?|readme|template)\.md$/i.test(p)
const name = (p: string) => p.split('/').at(-1)!.replace(/\.md$/i, '')

// A view of canonical sources: no import, local CRM writes or second identity store.
export async function sharedRelationships(action: string, args: Record<string, unknown>, read: Read) {
  if (!['snapshot', 'profile'].includes(action)) throw new Error('Os perfis compartilhados são consultados na fonte. Nenhum cadastro paralelo foi criado.')
  const index = await read('/notes')
  const ownerIndex = await read('/owner-profiles').catch((e: Error) => { if (e.message.includes('not enabled')) return []; throw e })
  if (!Array.isArray(index)) throw new Error('Índice de relacionamentos indisponível')
  const entries: Entry[] = index.filter((n: Entry) => typeof n.path === 'string')
  const profiles = [...new Map([...entries, ...ownerIndex].filter(n => profile(n.path)).map(n => [n.path, n])).values()]
  const contacts = profiles.map(n => ({ id: n.path, path: n.path, name: n.title || name(n.path), kind: n.path.toLowerCase().startsWith('people/') ? 'person' : 'company' }))
  if (action === 'snapshot') return { contacts, capabilities: { sharedMemory: true, canWrite: false } }
  const contact = contacts.find(n => n.path === args.path)
  if (!contact) throw new Error('Perfil indisponível no MCP')
  const ownerOnly = !entries.some(n => n.path === contact.path)
  const note = await read((ownerOnly ? '/owner-profile?path=' : '/note?path=') + encodeURIComponent(contact.path))
  if (typeof note.body !== 'string') throw new Error('Perfil indisponível no MCP')
  const links = new Map<string, Entry>()
  let unavailable = 0
  // Resolve only explicit links against the permission-filtered MCP index.
  for (const match of note.body.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = match[1].replace(/\\\|/g, '|').split('|')[0].split('#')[0].trim()
    if (!target) continue
    const exact = entries.find(n => n.path === (target.endsWith('.md') ? target : target + '.md'))
    const candidates = exact ? [exact] : entries.filter(n => name(n.path) === target)
    if (candidates.length === 1) { if (candidates[0].path !== contact.path) links.set(candidates[0].path, candidates[0]) }
    else unavailable++
  }
  return { ...contact, ownerOnly, body: note.body, sources: [...links.values()].map(n => ({ path: n.path, title: n.title || name(n.path), kind: profile(n.path) ? 'profile' : 'record' })), unavailable }
}
