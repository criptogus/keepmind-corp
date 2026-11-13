# Value, continuity and evidence UX

This change surfaces existing capabilities without changing agent authority, authentication, storage or billing. It does not claim measured conversion gains, verified AI answers or 60fps performance.

- Today offers capture, context and relationship entry points plus the three most recently updated active projects.
- Chat starters prepare editable drafts and preserve existing text until replacement is confirmed. Reported source paths open the original memory; absence of paths is explicit. Steps are disclosed separately from evidence and writes.
- Projects can be searched and filtered by state. The summary separates accepted decisions from proposals, highlights the next step and links evidence. Preparing context announces progress, focuses the resulting heading and transfers an unsent draft to Chat.
- Memory shows readable labels while preserving paths and original content. Search method uses actual `semantic`/`asOf` fields, with an explicit unknown fallback. Opening a result moves focus to the source region.
- Motion uses existing CSS/components: 120ms feedback, 180ms surface entrances, no animated layout dimensions or completion-dependent state. System and app reduced-motion preferences are honored. Streaming follows only readers already near the bottom; an explicit action returns to the latest answer. Draft textareas grow to 140px then scroll.

## Repeatable validation

`npm run typecheck`, `TMPDIR=/private/tmp npm test` (macOS), `npm run build`, `npm run test:experience`.

The existing experience batch now checks project filtering, starter drafts without automatic submission, reported source → full memory → preserved conversation, reduced motion, and the existing capture/retry, cancellation, navigation and onboarding checks. Screenshots and JSON are retained under `artifacts/experience-smoke`.

For manual visual inspection, run `npm run dev:onboarding` and open `http://127.0.0.1:4188/tests/fixtures/value-preview.html`. This development fixture uses the real App and synthetic bridge data; it does not call providers or save user memory. `?motion=reduced&error=1` demonstrates reduced motion and a first-attempt Today loading failure. Fixture chat history/preferences live only in the local preview origin. No real credentials or personal content belong in it.

Inspect desktop and compact windows: Today → project → prepare context → unsent conversation draft → synthetic response → original source. Test keyboard, empty filters, error/retry and motion preferences. Automated checks do not prove visual quality, full accessibility compliance, real provider quality or backend availability.

Focused UI/UX references supported motion preferences, preserving reading position, visible async feedback and transitions that do not gate correctness. Generic smooth-scroll guidance was not applied to streaming. Jev reviewed claim boundaries as advisory evidence; it does not replace tests or visual judgment.
