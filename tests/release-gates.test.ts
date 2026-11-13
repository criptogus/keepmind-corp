import { describe, expect, it } from 'vitest'
import { checkReleaseGates, checkSmokeReports, readWorkflows, releases } from '../scripts/check-release-gates.mjs'

const workflows = () => readWorkflows(process.cwd())
describe('release publication contract', () => {
  it('requires the actual release YAMLs to pass the contract', () => {
    expect(checkReleaseGates(workflows())).toEqual({ checked: 3, failed: 0, errors: [] })
  })
  it.each(releases)('%s cannot omit validation or publish before the complete matrix', name => {
    for (const mutation of [
      (w: any) => { delete w.jobs.validate },
      (w: any) => { delete w.jobs.build.needs },
      (w: any) => { w.jobs.publish.needs = ['validate'] },
      (w: any) => { w.jobs.publish.if = 'always()' },
      (w: any) => { w.jobs.build['continue-on-error'] = true },
      (w: any) => { w.jobs.validate.uses = './.github/workflows/ci.yml@main' },
      (w: any) => { w.jobs.build.steps.find((s: any) => s.uses?.startsWith('actions/checkout')).with = { ref: 'main' } },
      (w: any) => { const publisher = w.jobs.publish.steps.find((s: any) => s.uses?.startsWith('softprops/action-gh-release')); w.jobs.build.steps.push(publisher) },
      (w: any) => { w.jobs.publish.steps.find((s: any) => s.uses?.startsWith('actions/download-artifact')).with.pattern = '*' },
      (w: any) => { const pack = w.jobs.build.steps.find((s: any) => s.run?.startsWith('npx electron-builder')); pack.run = pack.run.replace('--publish never', '--publish always') },
      (w: any) => { w.jobs.build.steps.find((s: any) => s.uses?.startsWith('actions/upload-artifact')).with['if-no-files-found'] = 'warn' }
    ]) {
      const input = workflows(); mutation(input[name])
      expect(checkReleaseGates(input).failed).toBeGreaterThan(0)
    }
  })
  it.each(['npm test', 'npm run test:experience', 'npm run test:crm-browser'])('cannot silently skip or suppress %s', command => {
    for (const mutation of [
      (step: any) => { step.run = 'echo skipped' },
      (step: any) => { step['continue-on-error'] = true },
      (step: any) => { step.if = 'false' },
      (step: any) => { step.run += ' || true' }
    ]) {
      const input = workflows(); mutation(input['ci.yml'].jobs.check.steps.find((s: any) => s.run === command))
      expect(checkReleaseGates(input).failed).toBeGreaterThan(0)
    }
  })
  it('rejects absent or empty workflow input instead of no-op success', () => {
    expect(checkReleaseGates({}).failed).toBeGreaterThan(0)
  })
})

const reports = () => Object.fromEntries([['experience-smoke', 9], ['crm-smoke', 7]].map(([name, count]) => [name, { errors: [], checks: Array.from({ length: Number(count) }, (_, i) => ({ name: `flow-${i}`, result: 'passed' })) }]))
describe('release smoke evidence', () => {
  it('requires successful, nonempty reports from both smoke suites', () => {
    expect(checkSmokeReports(reports())).toEqual({ checked: 2, failed: 0, errors: [] })
    expect(checkSmokeReports({}).failed).toBe(2)
  })
  it.each(['experience-smoke', 'crm-smoke'])('rejects missing, failed, duplicate or incomplete %s results', name => {
    for (const mutate of [
      (r: any) => { r.checks = [] },
      (r: any) => { r.checks.pop() },
      (r: any) => { r.checks[0].result = 'failed' },
      (r: any) => { r.errors.push('browser exception') },
      (r: any) => { r.checks[1].name = r.checks[0].name }
    ]) {
      const input = reports(); mutate(input[name]); expect(checkSmokeReports(input).failed).toBe(1)
    }
  })
})
