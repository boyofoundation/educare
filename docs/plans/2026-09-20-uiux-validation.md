# EduCare UI/UX validation evidence

## Scope and ownership

This document records the integrated U1–U6 engineering verification on 2026-09-20 in
`uiux/frontend-improvements-20260920`, based on `89844da`. All five Team lanes were preserved
and merged through `6e9dd92`, followed by integration fixes and regression coverage in `5e54fcd`. The main
worktree was not merged, reset, or deployed. No dependencies or lockfiles were changed.

Engineering checks pass; the complete plan is **not yet accepted**. Human/device gates below
remain open, and measured LCP remains above 2500 ms. Browser automation ran headless against
production preview with a fixed Chromium project and fake/mocked provider credentials only.

The Playwright config owns port `4178` and points at Vite's `/educare/` base path. Build the
artifact before running it:

```bash
node ./node_modules/vite/bin/vite.js build
node ./node_modules/@playwright/test/cli.js test --config playwright.uiux.config.ts --grep '@final|@flows|@readability' --timeout=35000 --global-timeout=300000
# Keep production preview running on 4178 for the standalone performance harness.
node scripts/uiux-performance.mjs --samples 5 --artifact-dir /tmp/uiux-final-artifacts --output /tmp/uiux-final.json --compare .omx/reports/uiux-final-20260920/baseline.json
```

The final suite is intentionally separate from the baseline suite. Run `@baseline` against
the committed baseline before integrating UI changes; run `@final` only after the leader has
integrated the U1–U6 commits. Run the performance harness without concurrent builds/tests.
A failing final assertion must remain visible rather than being
converted to a skip.

## Acceptance coverage

| Area              | Automated check                                                                                                                                              | Evidence boundary                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| U1 first run      | Template → save → first mocked chat in ≤3 setup actions; completion persists after reload; existing/shared entry unit regressions                            | Five-person usability trial is not performed                                    |
| U2 drawer/modal   | Mobile focus exclusion/return, modal focus trap/scroll lock; nested modal unit regressions; light/dark onboarding heading contrast ≥4.5 and close/skip ≥44px | Not a full-site contrast, focus-ring, zoom, or VoiceOver audit                  |
| U4 storage/share  | Injected IndexedDB failure preserves form and permits retry; appearance storage failure reports non-success; ZIP export without Turso or external writes     | Actual device quota exhaustion/offline lifecycle remains untested               |
| U3 mobile         | Browser shell/chat overflow and state at 360/390/768/1280px; unit tests preserve mounted chat/Canvas and scroll offsets at 360/390/768px                     | Browser Canvas file/checkpoint flows and physical keyboard/rotation remain open |
| U6 appearance     | Theme, reading size and reduced-motion persistence; light settings and light/dark onboarding screenshots inspected                                           | Not every math/code/citation/error state has a new screenshot audit             |
| U5 search/privacy | Exact message among 100 seeded sessions; rename/pin survive reload without modifying messages; shared and bundle privacy isolation                           | Local data and mocked services only                                             |
| U6 performance    | Five cold Chromium samples; 1,000-message top/middle/bottom navigation, bounded rendered nodes, append preserves reading position                            | LCP target remains unmet; profile retained below                                |

Integration regressions also cover complete deferred navigation intents, search/rename retry,
dirty-editor save ordering, metadata-preserving edits, partial upload retry, memory-only drafts,
onboarding persistence failure, concurrent provider initialization, required chunk failure/retry,
mounted settings refresh, and shared/bundle recovery entry points. Lazy-route errors are contained
within the route pane and offer an explicit reload with an unsaved-data warning; they do not offer
a misleading React.lazy reset that would reuse a rejected import.

## Final engineering checks

| Check                                                               | Result                                              |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| `node node_modules/typescript/bin/tsc --noEmit --pretty false`      | Pass                                                |
| `node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx`  | Pass, no warnings                                   |
| Prettier on changed files; `git diff --check`                       | Pass                                                |
| `node node_modules/vitest/vitest.mjs --run --reporter=dot`          | 103 files / 1,489 tests passed; no unhandled errors |
| Production Vite build                                               | Pass                                                |
| Headless production Playwright (`@final`, `@flows`, `@readability`) | 15/15 passed, no skipped tests, 18.3 s              |

Vitest still emits some existing React `act(...)` warnings and intentional error-path console
output. Node emits `module.register()` deprecation warnings. These are not hidden or counted as
test failures. The final full suite does not reproduce the baseline ShareModal teardown rejection.

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

Measured after integration using Chromium `140.0.7339.16`, headless, the same viewport,
CPU/network throttling, and five fresh contexts. No browser reinstall occurred between baseline
and final, but the old baseline JSON did not record a version field; the harness now records it.

| Metric                           |       Baseline |  Final |            Delta | Result                               |
| -------------------------------- | -------------: | -----: | ---------------: | ------------------------------------ |
| Median LCP (ms)                  |           4744 |   3668 |   -1076 (-22.7%) | Improved; **2500 ms target not met** |
| Median initial JS transfer bytes |         771109 | 606726 |          -164383 | Improved                             |
| Median initial JS gzip bytes     |         765062 | 601984 | -163078 (-21.3%) | Improved                             |
| Mobile horizontal overflow       |             no |     no |                — | Pass in sampled viewports            |
| Final UIUX E2E                   | not applicable |  15/15 |                — | Pass                                 |

Final LCP samples were **3720, 3668, 3764, 3656, 3668 ms**. Every sample reported 601984 initial
gzip bytes and no horizontal overflow. Initial means script resources completed by the measured
LCP (or 2000 ms, whichever is later), not all scripts fetched during startup. All sampled startup
scripts total 657613 gzip bytes; some provider chunks now load after LCP rather than disappearing.

The remaining profile points to initial payload/network work: `vendor-BKIW2ia-.js` is 248993
gzip bytes and finishes at 3396.5 ms in sample 1; `markdown-BguTdfJ5.js` is 165043 gzip bytes and
finishes at 2980.5 ms. Both are still requested from the initial dependency graph. This is evidence
of an unresolved initial dependency bottleneck, not proof that either module alone causes LCP.
Further splitting needs an import-dependency investigation and another same-condition measurement;
the 2.5-second target is not waived. Sample 1 aggregate metrics: script 214.9 ms, task 519.1 ms,
layout 57.6 ms, style recalculation 28.2 ms, used JS heap 6.89 MB.

## Preserved evidence and Team cleanup

- Team `educare-uiux-delivery-78f2747a` was gracefully shut down with `--confirm-issues`, not
  force-killed. The five worker branches are preserved as `archive/uiux-20260920-worker-1` through
  `archive/uiux-20260920-worker-5`; their commits are integrated in this branch.
- Pre-cleanup Team state and the leader checkpoint are under
  `.omx/backups/team-resume-20260920.ojRe5b/`; leader checkpoint commit: `76b58b7`.
- Post-cleanup notice ledger has empty `notices` and `wakes`; old worker panes are gone. No new
  Team was launched. Final bounded implementation/review used native Luna/max specialists.
- Local, git-ignored evidence is under `.omx/reports/uiux-final-20260920/`: baseline/final JSON,
  sample-1 HAR and traces, full validation logs, Playwright JSON, and four rendered screenshots.
  HAR/traces are local artifacts, not uploaded or committed.

## Outstanding human/device gates

These cannot be honestly replaced by automated test output:

- Five target users must attempt “建立英文助理”; record completion without prompting before
  claiming the plan's `4/5` usability target.
- Test iOS Safari and Android Chrome with the software keyboard open, submit/stop visible,
  rotation, and keyboard dismissal; a simulated viewport is not device evidence.
- Complete the onboarding, form, and chat path with VoiceOver and record any remaining focus
  defects.
- Review 200% zoom, focus rings, touch target dimensions, and 4.5:1 text / 3:1 control
  contrast across the full application. The new onboarding checks cover only their named controls
  and headings; the automated suite does not grant accessibility certification.
- Complete mobile browser Canvas file selection/checkpoint restoration and full create/edit/model
  settings/Canvas overflow coverage at all four widths; the mounted-pane unit checks and chat
  viewport E2E are not substitutes for these complete interaction paths.

## Limitations and reproducibility

- Tests use local storage and ephemeral browser contexts only. No Turso writes, provider
  credentials, remote model calls, or deployment are involved.
- No main-branch merge, deployment, live-provider connectivity claim, or human acceptance claim
  is made. The next functional wave remains gated on the plan's outstanding acceptance work.
