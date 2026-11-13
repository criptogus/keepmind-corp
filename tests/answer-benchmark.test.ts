import { describe, expect, it } from 'vitest'
import { compareAnswerBenchmarks, evaluateBenchmarkAnswer, listAnswerBenchmarkCases, runAnswerBenchmark, validateBenchmarkReport } from '../src/main/services/answer-benchmark'
import { ANSWER_SUITE } from '../src/main/services/benchmark-fixtures/answer-suite'
const ok = (evidence: string, status = 'pass', sourceId = 'facts', quote = 'project logo is blue') => JSON.stringify({ status, reason: 'Synthetic judgment', evidence: [evidence], sourceEvidence: [{ sourceId, quote }] })
describe('synthetic answer benchmark', () => {
  it('never sends the grading criterion to answer generation and records separate model judgments', async () => {
    const requests: {purpose:string; user:string}[] = []
    const report = await runAnswerBenchmark({ provider:'test-provider', model:'test-model', complete: async r => {
      requests.push(r)
      return r.purpose === 'answer' ? 'Synthetic answer [source:facts]' : ok('Synthetic answer')
    } })
    expect(report.cases).toHaveLength(6); expect(report.calls).toBe(12)
    for (let i = 0; i < 6; i++) {
      expect(requests[i*2].purpose).toBe('answer')
      expect(requests[i*2].user).not.toContain(ANSWER_SUITE[i].criterion)
      expect(requests[i*2+1].user).toContain(ANSWER_SUITE[i].criterion)
    }
    expect(report.cases[0].judgment).toBe('model_judged')
    // A scripted judge tests plumbing only; it is not measured model accuracy.
    expect(report.cases[0].status).toBe('pass')
    expect(report.cases[1].status).not.toBe('pass')
  })
  it('rejects malformed judgments, fabricated quotes and unknown or missing sources', () => {
    const c = ANSWER_SUITE[0], answer = 'The logo is blue [source:facts]'
    expect(evaluateBenchmarkAnswer(c, answer, '{').status).toBe('inconclusive')
    expect(evaluateBenchmarkAnswer(c, answer, ok('invented quote')).status).toBe('inconclusive')
    expect(evaluateBenchmarkAnswer(c, 'Blue [source:unknown]', ok('Blue')).status).not.toBe('pass')
    expect(evaluateBenchmarkAnswer(c, 'Blue', ok('Blue')).status).not.toBe('pass')
    expect(evaluateBenchmarkAnswer(c, answer, ok('logo is blue', 'fail')).status).toBe('fail')
  })
  it('passes temporal and proposal criteria to a separate judge, with explicit sources', () => {
    const historical = ANSWER_SUITE.find(c=>c.id === 'as-of')!
    const proposal = ANSWER_SUITE.find(c=>c.id === 'proposal')!
    expect(evaluateBenchmarkAnswer(historical, 'Red [source:history]', ok('Red', 'pass', 'history', 'logo was red')).checks.requiredSourcesCited).toBe(true)
    expect(evaluateBenchmarkAnswer(proposal, 'Still pending [source:proposal]', ok('Still pending', 'pass', 'proposal', 'No approval has been recorded.')).status).toBe('pass')
    expect(proposal.criterion).toContain('not approved'); expect(historical.criterion).toContain('red')
  })
  it('limits calls, handles errors/cancellation as inconclusive and compares only matching suites', async () => {
    let calls = 0
    const report = await runAnswerBenchmark({provider:'x',model:'y',maxCalls:2,complete:async () => { calls++; throw Error('offline') }})
    expect(calls).toBeLessThanOrEqual(2); expect(report.status).toBe('budget_exhausted')
    expect(report.cases.every(c=>c.status === 'inconclusive')).toBe(true)
    const controller = new AbortController(); controller.abort()
    const cancelled = await runAnswerBenchmark({provider:'x',model:'y',signal:controller.signal,complete:async()=>{throw Error('unexpected')}})
    expect(cancelled.status).toBe('cancelled'); expect(cancelled.calls).toBe(0)
    expect(compareAnswerBenchmarks(report,cancelled).cases).toHaveLength(6)
    expect(()=>compareAnswerBenchmarks(report,{...cancelled,suiteVersion:'different'})).toThrow('Incompatible')
    expect(listAnswerBenchmarkCases()).toHaveLength(6)
  })
})

it('rejects oversized material and invented source evidence', () => {
  const c = ANSWER_SUITE[0], answer = 'Blue [source:facts]'
  expect(evaluateBenchmarkAnswer(c, 'x'.repeat(12001), ok('x')).status).toBe('inconclusive')
  expect(evaluateBenchmarkAnswer(c, answer, 'x'.repeat(16001)).status).toBe('inconclusive')
  expect(evaluateBenchmarkAnswer(c, answer, ok('Blue', 'pass', 'facts', 'invented')).status).toBe('inconclusive')
  expect(evaluateBenchmarkAnswer(c, answer, JSON.stringify({status:'pass', reason:'x'.repeat(2001), evidence:['Blue'], sourceEvidence:[{sourceId:'facts',quote:'blue'}]})).status).toBe('inconclusive')
})
it.each(ANSWER_SUITE)('retains negative semantic judgments for $id even when answer repeats source words', c => {
  const source = c.sources[0]
  const answer = `Incorrect: not ${source.text.slice(0, 20)} [source:${source.id}] ${c.requiredSources.slice(1).map(id => `[source:${id}]`).join(' ')}`
  const result = evaluateBenchmarkAnswer(c, answer, ok('Incorrect: not', 'fail', source.id, source.text.slice(0, 20)))
  expect(result.status).toBe('fail')
})
it('compares exact suite fingerprints', async () => {
  const report = await runAnswerBenchmark({provider:'p',model:'m',maxCalls:0,complete:async()=>''})
  expect(() => compareAnswerBenchmarks(report, {...report,suiteFingerprint:'other'})).toThrow('Incompatible')
})

it('validates complete reports and rejects tampering of fingerprints, evidence and nested records', async () => {
  const report = await runAnswerBenchmark({ provider:'p', model:'m', complete:async r => r.purpose === 'answer' ? 'Synthetic answer [source:facts]' : ok('Synthetic answer') })
  expect(() => validateBenchmarkReport(report)).not.toThrow()
  const mutate = (fn: (value: any) => void) => { const copy = structuredClone(report); fn(copy); expect(() => validateBenchmarkReport(copy)).toThrow('BENCHMARK_RECORD_INVALID') }
  mutate(r => { r.suiteCases[0].criterion = 'changed' })
  mutate(r => { r.cases[0].sourceEvidence[0].quote = 'fabricated' })
  mutate(r => { r.cases[0].citations[0].sourceId = 'unknown' })
  mutate(r => { r.cases[0].checks = {} })
  mutate(r => { r.cases[0].answer = 'x'.repeat(12001) })
  mutate(r => { r.cases[1].id = r.cases[0].id })
  mutate(r => { r.calls = 999 })
})
