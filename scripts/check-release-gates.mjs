// Fail-closed release contract; validates real YAML, never calls a publisher.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

export const releases = ['release.yml', 'release-corp.yml', 'continuous.yml']
const requiredCommands = ['npm ci', 'npm run check:release-gates', 'npm run typecheck', 'npm test', 'npm run build', 'npm run corp:build-brain', 'npm run corp:check', 'npx playwright install --with-deps chromium', 'npm run test:experience', 'npm run test:crm-browser', 'node scripts/check-release-gates.mjs --reports']
const needs = job => Array.isArray(job?.needs) ? job.needs : job?.needs ? [job.needs] : []
const uses = (step, action) => typeof step.uses === 'string' && step.uses.startsWith(`${action}@`)
const mandatory = job => job && job.if === undefined && job['continue-on-error'] === undefined

export function readWorkflows(root) {
  return Object.fromEntries(['ci.yml', ...releases].map(name => [name, load(readFileSync(path.join(root, '.github/workflows', name), 'utf8'))]))
}
export function checkReleaseGates(workflows) {
  const errors = []
  const check = (condition, label) => { if (!condition) errors.push(label) }
  const ci = workflows['ci.yml'], gate = ci?.jobs?.check
  check(ci?.on && Object.hasOwn(ci.on, 'workflow_call'), 'CI must be callable from the publishing commit')
  check(ci?.permissions?.contents === 'read', 'CI must have read-only contents permission')
  check(mandatory(gate), 'CI check must not be skipped or allow failure')
  const steps = gate?.steps ?? []
  for (const command of requiredCommands) {
    check(steps.some(step => step.run === command && mandatory(step)), `CI must require: ${command}`)
  }
  check(steps.some(step => uses(step, 'actions/checkout') && !step.with?.ref && !step.with?.repository && mandatory(step)), 'CI must check out the caller commit')
  check(steps.findIndex(s => s.run === 'npm test') < steps.findIndex(s => s.run === 'npm run test:experience'), 'Tests must precede browser validation')
  check(steps.findIndex(s => s.run === 'node scripts/check-release-gates.mjs --reports') > steps.findIndex(s => s.run === 'npm run test:crm-browser'), 'Smoke evidence must be verified after both smokes')
  for (const name of releases) {
    const workflow = workflows[name], jobs = workflow?.jobs ?? {}
    check(workflow?.permissions?.contents === 'read', `${name}: default contents permission must be read`)
    check(jobs.validate?.uses === './.github/workflows/ci.yml' && mandatory(jobs.validate) && !jobs.validate.with && !jobs.validate.secrets, `${name}: validation must reuse same-commit CI without bypass inputs`)
    check(needs(jobs.build).includes('validate') && mandatory(jobs.build), `${name}: all builds must require validation success`)
    check(needs(jobs.publish).includes('validate') && needs(jobs.publish).includes('build') && mandatory(jobs.publish), `${name}: publication must require validation and the entire build matrix`)
    check(jobs.publish?.permissions?.contents === 'write', `${name}: only publisher needs contents write`)
    check(jobs.build?.permissions?.contents !== 'write', `${name}: build must not have contents write`)
    check(jobs.validate?.permissions?.contents !== 'write', `${name}: validation must not have contents write`)
    const platforms = (jobs.build?.strategy?.matrix?.include ?? []).map(entry => entry.os)
    check(['ubuntu-latest', 'macos-latest', 'windows-2022'].every(os => platforms.includes(os)), `${name}: require all three installer platforms`)
    const buildSteps = jobs.build?.steps ?? []
    check(buildSteps.some(step => uses(step, 'actions/checkout') && !step.with?.ref && !step.with?.repository && mandatory(step)), `${name}: builds must use the validated commit`)
    check(buildSteps.some(step => typeof step.run === 'string' && step.run.startsWith('npx electron-builder ') && step.run.endsWith('--publish never') && mandatory(step)), `${name}: packaging must disable automatic publication`)
    check(buildSteps.some(step => uses(step, 'actions/upload-artifact') && step.with?.['if-no-files-found'] === 'error' && mandatory(step)), `${name}: missing installers must fail the build`)
    const publishSteps = jobs.publish?.steps ?? []
    const artifactPattern = name === 'release-corp.yml' ? 'dist-corp-*' : 'dist-*'
    check(publishSteps.some(step => uses(step, 'actions/download-artifact') && step.with?.pattern === artifactPattern && mandatory(step)), `${name}: download only installer artifacts`)
    const publishers = Object.entries(jobs).flatMap(([id, job]) => (job.steps ?? []).filter(step => uses(step, 'softprops/action-gh-release')).map(step => ({ id, step })))
    check(publishers.length === 1 && publishers[0].id === 'publish' && mandatory(publishers[0].step), `${name}: publication must occur only once after all builds`)
  }
  return { checked: releases.length, failed: errors.length, errors }
}
export function checkSmokeReports(reports) {
  const errors = []
  for (const [name, minimum] of [['experience-smoke', 9], ['crm-smoke', 7]]) {
    const report = reports[name]
    if (!Array.isArray(report?.errors) || report.errors.length || !Array.isArray(report?.checks) || report.checks.length < minimum || report.checks.some(check => !check.name || check.result !== 'passed') || new Set(report.checks.map(check => check.name)).size !== report.checks.length) errors.push(`${name}: missing, empty, incomplete or failed smoke evidence`)
  }
  return { checked: 2, failed: errors.length, errors }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length > 1 || (args.length && args[0] !== '--reports')) throw Error('Usage: node scripts/check-release-gates.mjs [--reports]')
    const report = args[0] === '--reports'
      ? checkSmokeReports(Object.fromEntries(['experience-smoke', 'crm-smoke'].map(name => [name, JSON.parse(readFileSync(`artifacts/${name}/report.json`, 'utf8'))])))
      : checkReleaseGates(readWorkflows(process.cwd()))
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.failed ? 1 : 0
  } catch (error) {
    console.error(JSON.stringify({ failed: 1, error: error.message }))
    process.exitCode = 1
  }
}
