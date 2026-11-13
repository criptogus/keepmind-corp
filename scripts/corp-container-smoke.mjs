// Validates a prebuilt image with a disposable Docker volume; never publishes it.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
const image = process.argv[2]
if (!image) throw Error('Usage: node scripts/corp-container-smoke.mjs IMAGE')
const name = `keepmind-test-${randomBytes(6).toString('hex')}`, volume = name + '-data'
const url = 'http://127.0.0.1:18787', key = randomBytes(32).toString('hex')
const report = { checks: [], errors: [] }
const docker = (...args) => execFileSync('docker', args, { encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim()
async function request(route, body) {
  const r = await fetch(url+route,{method:body ? 'POST':'GET',headers:{Origin:url,'content-type':'application/json'},body:body ? JSON.stringify(body):undefined})
  return {status:r.status,body:await r.json()}
}
async function ready() {
  for(let i=0;i<60;i++){try { if ((await request('/api/health')).status===200 && docker('inspect','--format','{{.State.Health.Status}}',name)==='healthy') return }catch {} await new Promise(r=>setTimeout(r,500))}
  throw Error('Container failed readiness: '+docker('logs',name))
}
try {
  docker('volume','create',volume)
  docker('run','-d','--health-interval=1s','--health-start-period=1s','--name',name,'--mount',`source=${volume},target=/data`,'-p','127.0.0.1:18787:8787',
    '-e',`KEEPMIND_CORP_PUBLIC_URL=${url}`,'-e','KEEPMIND_CORP_EMAIL_DOMAINS=company.test','-e',`KEEPMIND_CORP_SETUP_TOKEN=${key}`,image)
  await ready(); assert.equal((await request('/api/meta')).body.setupRequired,true); report.checks.push('image starts as unprivileged server with persistent volume')
  assert.notEqual(docker('exec',name,'id','-u'),'0')
  const result = await request('/api/setup',{setupToken:key,orgName:'Container workspace',name:'Administrator',email:'admin@company.test',password:'synthetic-container-password',confirm:'synthetic-container-password'})
  assert.equal(result.status,201); report.checks.push('workspace creation through image HTTP endpoint')
  docker('restart',name); await ready()
  assert.equal((await request('/api/meta')).body.setupRequired,false)
  assert.equal((await request('/api/login',{email:'admin@company.test',password:'synthetic-container-password'})).status,200)
  report.checks.push('workspace and login survive container restart')
  console.log(JSON.stringify(report))
} catch(e) { report.errors.push(String(e)); process.exitCode=1; console.error(e) }
finally {
  try { docker('rm','-f',name) } catch {}
  try { docker('volume','rm',volume) } catch {}
  mkdirSync('artifacts/corp-container',{recursive:true}); writeFileSync('artifacts/corp-container/report.json',JSON.stringify(report,null,2)+'\n')
}
