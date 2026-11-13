# Onboarding UI validation

The native window supports 1024×640 and larger. Its old centered flex container placed the title above the viewport and the actions below it when the AI choices exceeded the available height. The onboarding now uses three grid rows: identity/progress, a scrollable content region, and persistent actions. Provider descriptions, requirements and data destinations reuse the existing visual tokens and icon components. Motion is brief and respects both the system preference and KeepMind's appearance setting.

## Reproduce and inspect safely

```sh
npm run dev:onboarding
```

Open `http://127.0.0.1:4188/tests/fixtures/wizard-preview.html`. This renders the production Wizard with a synthetic bridge: it never creates accounts, contacts a provider or saves user memory. Use `?motion=reduced&error=1` for the reduced-motion preference and a first-attempt save failure. Never put real credentials in this fixture.

Inspect 1440×900, 1024×640 and a compact 390×844 viewport. Header/actions must remain visible, all content must be reachable by scrolling, and Tab/Enter must reach the skip/continue actions. Change providers and confirm each draft remains scoped to that provider. After skipping AI, enter a synthetic idea, observe the first save failure, retry and open the completion step. Check focus on the new step heading.

The existing `npm run test:experience` batch includes the three-viewport geometry, keyboard and reduced-motion regression. Unit tests preserve the recovery-key acknowledgement gate, failed capture retry and provider draft separation. These fixtures validate the interface and control flow, not real cloud authentication, model download performance or AI answer quality.

Native before evidence: title was cut off in the published 0.2.6 macOS application. Controlled renderer measurement at 1280×720: heading top −107.55 px; final action bottom 828.55 px. With the fix at 1024×640: header top 0; footer bottom 640; no horizontal overflow. The 390×844 layout also keeps the header/footer in bounds. Screenshots and the audit report are retained in the task workspace; CI retains fresh smoke screenshots.
