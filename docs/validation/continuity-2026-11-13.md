# Continuity validation — 2026-11-13

This report records a functional check of the native project analysis and answer
benchmark. All live inputs were fictional. No user notes, private projects,
credentials, account identifiers or access tokens are included in these reports.

## Automated checks

- TypeScript checks and native production build passed.
- The full test run passed 139 tests, with two pre-existing skips: the optional
  scale test and a previously skipped CLI test.
- Corp frontend build and server self-check passed. The separate Corp backend
  still does not implement continuity or answer benchmarks.
- App and standalone MCP package dry runs included their shared memory modules.
- Functional renderer tests exercised project creation, decision and lesson
  review, artifact links, stale analyses, benchmark progress, cancellation,
  errors, history and incompatible comparisons in a DOM environment.

The automated provider responses are test fixtures. They test implementation
behavior and boundaries, not real model quality.

## Live answer benchmark

The native `runAnswerBenchmark` runner called the existing `llm.chat` provider
adapter with Codex, reporting model `gpt-6.1-sol`. It completed six cases with
12 calls. The same configured model generated answers and evaluated them in
separate requests. Citation identifiers, quoted answer evidence and quoted
source evidence also passed the deterministic checks.

| Case | Observed model judgment |
|---|---|
| Current correction | Pass |
| Fact at an earlier date | Pass |
| Proposal awaiting human review | Pass |
| Conflicting unverified notes | Pass |
| Project handoff and rejected attempt | Pass |
| Information unavailable from another space | Pass |

The [complete benchmark record](answer-benchmark-2026-11-13.json) includes the
questions, sources, criteria, answers, evaluator reasons, literal evidence and
suite fingerprint. This is one synthetic execution with a fallible model judge.
It does not establish a general accuracy rate, independent evaluation or
superiority over another model or product. The unavailable-space case tests
answer behavior; actual access controls are covered separately by integration
tests.

## Live project analysis

The native `MemoryIntelligence.projectAnalyze` path used a temporary encrypted
vault with a synthetic logo experiment. The decision predicted that at least
eight of ten participants could read a red logo. The source reported that only
two of ten could read it, while nine of ten could read a blue alternative, and
explicitly described the sample as small and nonrandomized.

Codex returned two proposed relationships, `possible_contradiction` and
`complementary`, with source quotations accepted by literal validation. The
outcome comparison was `limited` evidence and `not_established` causality. The
saved project remained encrypted, the analysis context was current, and the
findings remained proposals pending human review.

The [complete analysis record](project-analysis-2026-11-13.json) retains the
synthetic fixture, structured project, findings, source hashes and handoff.
This smoke check verifies the live request, response validation and persistence
path for one example. It does not establish semantic correctness across projects.

## Remaining validation limits

Visual inspection in an installed desktop application has not been completed.
The local Chromium launch was blocked by this environment, and its managed
browser could not reach the development server. The interaction tests use a DOM
environment and do not verify rendering or native window behavior.

These checks do not merge the pull request, publish an application release,
deploy the hosted site or add the missing Corp backend.
