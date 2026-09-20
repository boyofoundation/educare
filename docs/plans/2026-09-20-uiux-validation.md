# EduCare UI/UX validation evidence

## Scope and ownership

This document records the UI/UX verification lane for U1–U6. It deliberately uses a
production preview, one fixed Chromium project, and no provider credentials. The lane owns
only the `uiux-*` Playwright specs, `playwright.uiux.config.ts`, `scripts/uiux-*.mjs`, and
this evidence document; it does not change application production code, package metadata, or
lockfiles.

The Playwright config owns port `4178` and points at Vite's `/educare/` base path. Build the
artifact before running it:

```bash
node ./node_modules/vite/bin/vite.js build
node ./node_modules/@playwright/test/cli.js test --config=playwright.uiux.config.ts --grep @baseline
node scripts/uiux-performance.mjs --samples 5 --artifact-dir /tmp/uiux-baseline-artifacts-5 --output /tmp/uiux-baseline.json
node scripts/uiux-performance.mjs --samples 5 --output /tmp/uiux-final.json --compare /tmp/uiux-baseline.json
node ./node_modules/@playwright/test/cli.js test --config=playwright.uiux.config.ts --grep @final
```

The final suite is intentionally separate from the baseline suite. Run `@baseline` against
the committed baseline before integrating UI changes; run `@final` only after the leader has
integrated the U1–U6 commits. A failing final assertion must remain visible rather than being
converted to a skip.

## Acceptance coverage

| Area              | Automated check                                                                                                              | Evidence boundary                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| U1 first run      | `uiux-final.spec.ts`: clean local storage, template path, completion persistence, reload                                     | No provider/API key or remote model call                                                                |
| U2 drawer/modal   | `uiux-final.spec.ts`: closed mobile drawer is not in focus order; Escape and focus return; provider dialog focus/scroll lock | Keyboard assertions cover Chromium only; VoiceOver remains external                                     |
| U4 storage/share  | `uiux-final.spec.ts`: blocked appearance storage reports a non-success status; provider modal opens without credentials      | IndexedDB quota/device-specific behavior needs a real-browser follow-up                                 |
| U3 mobile         | `uiux-baseline.spec.ts` and `uiux-final.spec.ts`: 390×844 and 1280px overflow checks; mobile drawer path                     | Physical keyboard/rotation is not represented by a viewport emulation                                   |
| U6 appearance     | `uiux-final.spec.ts`: light theme, reading size, reduced motion persist and remain outside preview iframe                    | Contrast, print, and embedded artifact visual review remain external                                    |
| U5 search/privacy | `uiux-final.spec.ts`: local search result/empty state, no provider requests, shared mode has no private search entry         | Requires integrated navigation search implementation and seeded local data for positive-result coverage |
| U6 performance    | `scripts/uiux-performance.mjs`: five cold Chromium samples at fixed mobile/network/CPU conditions                            | LCP may be unavailable on a Chromium build; the JSON records `null` instead of inventing a value        |

## Baseline (commit `89844da`)

Measured against the baseline production preview on 2026-09-20. Each sample used a fresh
headless Chromium context at `390×844`, CPU throttling `4×`, download `1.6 Mbps`, upload
`750 Kbps`, and `150 ms` latency. The browser was allowed two seconds after `load` for the
largest-contentful-paint observer to settle.

|     Sample | LCP (ms) | initial JS transfer bytes | initial JS gzip bytes |
| ---------: | -------: | ------------------------: | --------------------: |
|          1 |     5624 |                    771109 |                765062 |
|          2 |     4692 |                    771109 |                765062 |
|          3 |     4732 |                    771109 |                765062 |
|          4 |     4744 |                    771109 |                765062 |
|          5 |     4884 |                    771109 |                765062 |
| **median** | **4744** |                **771109** |            **765062** |

The baseline median LCP is above the plan's `≤2500 ms` target. This is a measured baseline,
not a claim that the target is met. The transfer number is the browser-reported compressed
resource transfer for initial JavaScript; it includes transfer overhead. The separate gzip
column is calculated from the exact `dist/assets/*.js` files requested by the page at gzip
level 9, so it is the comparable bundle-size metric rather than a claim about HTTP headers.

The detailed baseline run also captured a HAR and Chromium trace for sample 1 under
`/tmp/uiux-baseline-artifacts-5/` and recorded script resource timings in the JSON output. The
initial JavaScript gzip breakdown was:

| Module                     | Response end (ms) | Transfer bytes | Gzip bytes |
| -------------------------- | ----------------: | -------------: | ---------: |
| `vendor-F6IiWY1K.js`       |              4387 |         414200 |     411716 |
| `index-BoR2pccp.js`        |              3250 |         177322 |     176637 |
| `react-vendor-Bsj2qgg8.js` |              2305 |          77861 |      77419 |
| `highlight-C732I_wS.js`    |              1833 |          51658 |      51140 |
| `ai-libs-AvMxdEry.js`      |              2168 |          40790 |      39778 |
| `turso-DdGEoPju.js`        |              1753 |           4339 |       4034 |
| `markdown-upVzGTIj.js`     |               645 |           3270 |       2970 |
| `utils-Dob3nYDb.js`        |               618 |           1669 |       1368 |

The dominant initial payload is the vendor chunk (`411716` gzip bytes), followed by the app
entry (`176637`). This identifies the measurement bottleneck; it does not by itself justify a
chunking change or claim that an LCP target is met.

The harness also records Chromium `Performance.getMetrics` for the diagnostic sample. One
baseline diagnostic sample reported `ScriptDurationMs=646.9`, `TaskDurationMs=2209.2`,
`LayoutDurationMs=639.0`, `RecalcStyleDurationMs=120.7`, and `JSHeapUsedSize=7.85 MB`.
These are aggregate browser timings, not per-module parse times; they are included to keep
CPU/layout work visible when comparing the final artifact.

## Final comparison

Fill this table only after all required UI commits are integrated and the same commands and
conditions have been rerun. Do not copy the baseline values into the final column.

| Metric                           |       Baseline |   Final |   Delta | Result  |
| -------------------------------- | -------------: | ------: | ------: | ------- |
| Median LCP (ms)                  |           4744 | pending | pending | pending |
| Median initial JS transfer bytes |         771109 | pending | pending | pending |
| Median initial JS gzip bytes     |         765062 | pending | pending | pending |
| Mobile horizontal overflow       |             no | pending |       — | pending |
| Final UIUX E2E                   | not applicable | pending |       — | pending |

## Outstanding human/device gates

These cannot be honestly replaced by automated test output:

- Five target users must attempt “建立英文助理”; record completion without prompting before
  claiming the plan's `4/5` usability target.
- Test iOS Safari and Android Chrome with the software keyboard open, submit/stop visible,
  rotation, and keyboard dismissal; a simulated viewport is not device evidence.
- Complete the onboarding, form, and chat path with VoiceOver and record any remaining focus
  defects.
- Review 200% zoom, focus rings, touch target dimensions, and 4.5:1 text / 3:1 control
  contrast in a rendered browser; the automated suite does not grant accessibility
  certification.

## Limitations and reproducibility

- Tests use local storage and ephemeral browser contexts only. No Turso writes, provider
  credentials, remote model calls, or deployment are involved.
- `@final` assertions are expected to remain blocked or fail until the integrated AppShell,
  navigation/search, onboarding, appearance, modal, and storage-status wiring is present.
- Existing Vitest baseline output had 1,443 passing tests but one unhandled ShareModal teardown
  rejection (`window is not defined`); that unrelated baseline issue is tracked separately
  and is not reclassified as a UIUX pass.
