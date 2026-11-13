import initSqlJs, { type Database } from 'sql.js'
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// ── Local auth: SQLite (sql.js/WASM) + scrypt password hashing ──
// Small, fast, fully local. Users table + session tokens.

export interface AuthUser {
  id: number
  email: string
  name: string
  googleSub?: string
}

const SCRYPT_KEYLEN = 32

function hashPassword(password: string, salt: Buffer): string {
  return scryptSync(password, salt, SCRYPT_KEYLEN, { N: 16384, r: 8, p: 1 }).toString('hex')
}

export class AuthService {
  private db: Database | null = null
  private ready: Promise<void>
  private dbFile: string
  private restoreDatabase!: (bytes: Uint8Array) => Database

  constructor(dir: string) {
    this.dbFile = join(dir, 'auth.db')
    this.ready = this.init()
  }

  private async init() {
    const SQL = await initSqlJs({
      locateFile: (f: string) => join(__dirname, '../../node_modules/sql.js/dist', f)
    })
    this.restoreDatabase = bytes => new SQL.Database(bytes)
    this.db = existsSync(this.dbFile)
      ? new SQL.Database(new Uint8Array(readFileSync(this.dbFile)))
      : new SQL.Database()
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        pass_hash TEXT,
        salt TEXT,
        google_sub TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions(
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `)
    this.persist()
  }

  private persist() {
    const temporary = this.dbFile + '.tmp'
    try {
      writeFileSync(temporary, Buffer.from(this.db!.export()), { mode: 0o600 })
      renameSync(temporary, this.dbFile)
    } finally { rmSync(temporary, { force: true }) }
  }

  private async q<T = any>(fn: (db: Database) => T): Promise<T> {
    await this.ready
    const previous = this.db!.export()
    try {
      const res = fn(this.db!)
      this.persist()
      return res
    } catch (error) {
      // A failed save must not leave an account that a later read could persist.
      this.db!.close()
      this.db = this.restoreDatabase(previous)
      throw error
    }
  }

  // sql.js exec() returns rows as positional arrays, not objects:
  // users columns = id, email, name, pass_hash, salt, google_sub, created_at
  private static toUser(row: any[]): AuthUser {
    return { id: row[0], email: row[1], name: row[2], googleSub: row[5] ?? undefined }
  }

  async userCount(): Promise<number> {
    return this.q(db => db.exec('SELECT COUNT(*) c FROM users')[0]?.values[0]?.[0] as number ?? 0)
  }

  async hasUsers(): Promise<boolean> { return (await this.userCount()) > 0 }

  async findByEmail(email: string): Promise<AuthUser | null> {
    return this.q(db => {
      const r = db.exec('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()])
      return r.length ? AuthService.toUser(r[0].values[0] as any) : null
    })
  }

  async register(email: string, password: string, name = ''): Promise<AuthUser> {
    const e = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Invalid email')
    if (password.length < 8) throw new Error('Password must be at least 8 characters')
    const existing = await this.findByEmail(e)
    if (existing) throw new Error('An account with this email already exists')
    const salt = randomBytes(16)
    const hash = hashPassword(password, salt)
    return this.q(db => {
      db.run('INSERT INTO users(email,name,pass_hash,salt,created_at) VALUES(?,?,?,?,?)',
        [e, name.trim(), hash, salt.toString('hex'), new Date().toISOString()])
      const r = db.exec('SELECT * FROM users WHERE email = ?', [e])
      return AuthService.toUser(r[0].values[0] as any)
    })
  }

  async verifyPassword(email: string, password: string): Promise<AuthUser | null> {
    return this.q(db => {
      const r = db.exec('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()])
      if (!r.length) return null
      const row: any = r[0].values[0]
      if (!row[3] || !row[4]) return null // google-only account
      const salt = Buffer.from(row[4], 'hex')
      const hash = Buffer.from(row[3], 'hex')
      const candidate = Buffer.from(hashPassword(password, salt), 'hex')
      if (hash.length !== candidate.length || !timingSafeEqual(hash, candidate)) return null
      return AuthService.toUser(row)
    })
  }

  // Google sign-in: link by google_sub or email, create if needed
  async upsertGoogle(profile: { sub: string; email: string; name?: string }): Promise<AuthUser> {
    const sub = String(profile.sub ?? '')
    const e = String(profile.email ?? '').trim().toLowerCase()
    const name = String(profile.name ?? '')
    if (!sub && !e) throw new Error('Google profile is missing both sub and email')
    return this.q(db => {
      let r = db.exec('SELECT * FROM users WHERE google_sub = ?', [sub])
      if (!r.length && e) r = db.exec('SELECT * FROM users WHERE email = ?', [e])
      if (r.length) {
        const row: any = r[0].values[0]
        if (!row[5] && sub) db.run('UPDATE users SET google_sub = ? WHERE id = ?', [sub, row[0]])
        const rr = db.exec('SELECT * FROM users WHERE id = ?', [row[0]])
        return AuthService.toUser(rr[0].values[0] as any)
      }
      db.run('INSERT INTO users(email,name,google_sub,created_at) VALUES(?,?,?,?)',
        [e || `google-${sub}@users.local`, name, sub || null, new Date().toISOString()])
      const rr = db.exec('SELECT * FROM users WHERE id = (SELECT MAX(id) FROM users)')
      return AuthService.toUser(rr[0].values[0] as any)
    })
  }

  async createSession(userId: number): Promise<string> {
    const token = randomBytes(32).toString('hex')
    const now = Date.now()
    await this.q(db => db.run('INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)',
      [token, userId, new Date(now).toISOString(), new Date(now + 30 * 864e5).toISOString()]))
    return token
  }

  async userByToken(token?: string | null): Promise<AuthUser | null> {
    if (!token) return null
    return this.q(db => {
      const r = db.exec('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', [token])
      if (!r.length) return null
      const row: any = r[0].values[0]
      if (new Date(row[row.length - 1]).getTime() < Date.now()) {
        db.run('DELETE FROM sessions WHERE token = ?', [token])
        return null
      }
      return AuthService.toUser(row)
    })
  }

  async deleteSession(token: string) {
    await this.q(db => db.run('DELETE FROM sessions WHERE token = ?', [token]))
  }
}
