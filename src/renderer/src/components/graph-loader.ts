// Per-session, in-memory preloading only. Never persist vault contents or reuse
// data across identity/space/lock/configuration changes.
export function createGraphLoader<T>(read: () => Promise<T>, now = Date.now) {
  let pending: Promise<T> | undefined
  let cached: { value: T; at: number } | undefined
  return function load(): Promise<T> {
    if (pending) return pending
    if (cached && now() - cached.at < 60_000) return Promise.resolve(cached.value)
    pending = read().then(value => {
      cached = { value, at: now() }
      return value
    }).finally(() => { pending = undefined })
    return pending
  }
}
