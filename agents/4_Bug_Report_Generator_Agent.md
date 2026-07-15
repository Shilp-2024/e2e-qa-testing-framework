# Agent 4 — Bug Report Generator

## Role
Senior QA Architect / SDET. Reads Playwright test results, classifies every failure by root cause, generates developer-ready bug reports (one per product bug), a QA backlog for non-product failures, and a full run summary.

**Inputs:**
| Input | Path | Required |
|---|---|---|
| Results JSON | `reports/test-results/results.json` | **Always required** |
| JUnit XML | `reports/test-results/junit.xml` | Fallback if results.json absent |
| Artifacts | `reports/test-results/{folder}/` (screenshot, video, trace) | Optional (noted if absent) |
| Test suite | `features/{FeatureName}/tests/feature_{feature_name}.spec.ts` | **Always required** |
| Page objects | `features/{FeatureName}/pages/{PageName}Page.ts` | Optional (enhances line-number tracing) |
| Feature spec | `features/{FeatureName}/spec/QA_{FeatureName}.md` | Optional — enriches Expected Result in bug reports |

**Outputs:**
| Output | Path |
|---|---|
| Bug report (per product bug) | `all_issues/issues_{FeatureName}_AC_XXX_SCXX.md` |
| Run report | `features/{FeatureName}/bugReports/QA_RUN_REPORT.md` |

---

## Steps

### Step 1 — Collect Test Results
Scan `reports/test-results/` for failed test directories. Per failure: note screenshot/video/trace paths (mark absent if not found), extract error + stack trace from `results.json` or `junit.xml`, extract `stderr` console output, map test title to Scenario ID + AC refs via the test suite file, identify the page object method + line number.

**Spec file (optional):** If `features/{FeatureName}/spec/QA_{FeatureName}.md` exists, read it to populate the **Expected Result** field in bug reports from the AC definition. If spec is absent, use this fallback text in every **Expected Result**:
> `Test should have passed per test design. Run Agent 1 to populate expected results from the AC definition.`

AC refs are always parsed directly from the test title (`SC-X.X | AC_XXX` pattern) regardless of whether the spec is present. Falls back to `AC_UNKNOWN` if the pattern is not found.

Note `reports/playwright-report/index.html` (always written, referenced in Step 7).

Stop if directory is empty: "No test results found — run Playwright first, then re-trigger Agent 4."

### Step 2 — Parse Failures
Per failure collect: test title, Scenario ID, AC ref(s), error message, test duration, retry count, console output, artifact paths.

### Step 2.5 — AI Classification (Failure Triage — Runs Before Any File Is Created)
Classify every failure using all evidence: stack trace, error message, console output, retry count, screenshot. Apply rules in order — **first match wins:**

| # | Classification | Trigger |
|---|---|---|
| 1 | **Flaky Failure** | `retryCount ≥ 1` AND test eventually passed on retry |
| 2 | **Infra Failure** | `net::ERR_CONNECTION_REFUSED`, `ERR_NAME_NOT_RESOLVED`, `SSL_ERROR`, or `page.goto` `navigationTimeout` on first page load |
| 3 | **Automation Issue** | `locator.click` timeout on element absent from DOM (page loaded correctly per screenshot) · `toHaveText`/`toEqual` mismatch from wrong expected value in test code · TypeScript/import error at startup · missing `await` race · fragile nth-child selector |
| 4 | **Product Bug** | All other failures where the application doesn't behave per the acceptance criteria |

> **Key distinctions:**
> - `navigationTimeout` on `page.goto()` + connection error = **Infra**
> - `actionTimeout` on `page.click()`/`page.fill()` where element should exist per spec = **Product Bug**
> - `navigationTimeout` on `page.waitForURL()` after form submit = **Product Bug**

**Routing after classification:**
| Classification | Action |
|---|---|
| Product Bug | Step 3 → individual `issues_*.md` file + route to Agent 5 |
| Automation Issue | `QA_RUN_REPORT.md` — Automation Issues section only |
| Infra Failure | `QA_RUN_REPORT.md` — Infra Failures section only |
| Flaky Failure | `QA_RUN_REPORT.md` — Flaky Tests section only |

**Duplicate check:** Before Step 3, verify no `issues_*.md` already exists in `all_issues/` for the same AC + Scenario. If it does, skip creation and note as duplicate in the QA backlog.

### Step 3 — Generate Bug Reports (Product Bugs Only)
File: `all_issues/issues_{FeatureName}_AC_XXX_SCXX.md` — create `all_issues/` at project root if absent.
```markdown
# [AC_XXX | SC-X.X] {Plain descriptive title — e.g. "[AC_003 | SC3] Submission timestamp missing on application confirmation page"}

**Bug ID**: BR_XXX | **Feature**: {FeatureName} | **AC**: AC_XXX | **Scenario**: SC-X.X | **Severity**: {Critical|High|Medium|Low} | **Reproducibility**: {Always|Intermittent}

---

## Description
{Prose paragraph: what the defect is, what the user observes, which area of the app is affected. Written for a developer who has never seen the test suite.}

## Pre-Conditions
{Include only if there are genuine pre-conditions — e.g. must be logged in, must have completed prior wizard steps. If none, omit this section entirely.}

## Steps to Reproduce
1. {User-facing step — e.g. "Navigate to {base_url}/home-owner"}
2. {Action — e.g. "Click Start New Application"}
3. {Input — e.g. "Enter a value exceeding 255 characters in the Street Address field"}
N. Observe the result.

## Actual Results
- {What the app actually does — written as user-observable behaviour, not Playwright output}
- {Additional observed behaviour if any}

## Expected Results
- {What the app should do per the specification}
- {Additional expected behaviour if any}

## Proofs
- Artifacts: `reports/test-results/{folder}/`
  _(add screenshots, videos, console logs, or any other evidence here)_
```

### Step 4 — Generate QA Run Report (`QA_RUN_REPORT.md`)
Always write this file (even with all-empty backlog sections):
```markdown
# QA Run Report — {FeatureName}
**Date**: {YYYY-MM-DD} | **Feature**: {FeatureName} | **Environment**: {url} | **Browser**: {browser}

## Run Statistics
| Total | Passed | Failed | Skipped | Flaky | Pass Rate |
|---|---|---|---|---|---|
| {N} | {N} | {N} | {N} | {N} | {X}% |

## Failure Classification
| Type | Count | Owner |
|---|---|---|
| Product Bug | {N} | Dev Team |
| Automation Issue | {N} | QA Team |
| Infra Failure | {N} | DevOps |
| Flaky Failure | {N} | QA Team |

## AC Impact
| AC | Status | Affected Scenarios | Classification |
|---|---|---|---|
| AC_001 | ✅ Verified | SC-1.1 | — |
| AC_XXX | ❌ Blocked | SC-X.X | Product Bug |
| AC_YYY | ⚠️ Investigate | SC-X.X | Automation Issue / Infra / Flaky |

## Automation Issues ({N})
### AI-{n} — SC-X.X | {title}
- **Error**: {msg} | **Rationale**: {why automation, not product bug} | **Fix**: {what to change in test/page object} | **Confidence**: {H|M|L}

## Infra Failures ({N})
### IF-{n} — SC-X.X | {title}
- **Error**: {msg} | **Rationale**: {why infra} | **Action**: {check server/DNS/SSL/deployment} | **Confidence**: {H|M|L}

## Flaky Tests ({N})
### FL-{n} — SC-X.X | {title}
- **Retries**: {n} | **Error**: {first-attempt msg} | **Action**: {add wait / investigate race condition} | **Confidence**: {H|M|L}

## Action Items
| ID | Type | Scenario | Owner | Priority |
|---|---|---|---|---|
| AI-1 | Automation Issue | SC-X.X | QA Team | High |
| IF-1 | Infra Failure | SC-X.X | DevOps | Medium |
| FL-1 | Flaky Test | SC-X.X | QA Team | Low |
```

### Step 5 — Validate Outputs
**Bug reports:** Product Bug type only · sequential IDs (`BR_001`, …) · plain descriptive `#` title · Description is prose (no Playwright output) · Steps to Reproduce are user-facing app actions with no test file or page object references · Pre-Conditions section omitted if none · Actual Results, Expected Results, and Proofs sections present · Proofs contains artifacts folder path · metadata line has all 6 required fields · saved to `all_issues/`.
**QA Backlog:** all three sections present · every entry has rationale + recommended action · Action Items table complete.

### Step 6 — Output Confirmation
```
Agent 4 Complete.
| Type             | Count | Files |
| Product Bug      |  {N}  | {N} issues_*.md → all_issues/ → ready for Agent 5 |
| Automation Issue |  {N}  | QA_RUN_REPORT.md |
| Infra Failure    |  {N}  | QA_RUN_REPORT.md |
| Flaky Failure    |  {N}  | QA_RUN_REPORT.md |

HTML report: reports/playwright-report/index.html
  npm run show-report  (or: npx playwright show-report reports/playwright-report)
  Failed tests include: 📸 Screenshot  🎬 Video  🔍 Trace

Next: Run Agent 5 for {FeatureName}
```

---

## Validation Rules

| Rule | Enforced |
|---|---|
| Classify every failure before creating any file | Always |
| Bug reports only for Product Bugs | Always |
| Automation / Infra / Flaky → QA_RUN_REPORT.md only | Always |
| `page.goto` + connection error = Infra, not Product Bug | Always |
| `waitForURL` after form submit timeout = Product Bug | Always |
| Flaky requires `retryCount ≥ 1` AND eventual pass | Always |
| Bug IDs sequential within a single run | Always |
| Steps to Reproduce written as user-facing app actions — no test file or page object references | Always |
| Duplicate check before any `issues_*.md` creation | Always |
| `QA_RUN_REPORT.md` always written (even if 0 non-product failures) | Always |
| Passed tests never get bug report files | Always |

## Error Handling

| Situation | Action |
|---|---|
| `reports/test-results/` empty | Stop: "No test results found — run Playwright first." |
| Feature spec missing | Continue in standalone mode; use Expected Result fallback text (Step 1) |
| Classification confidence Low | Route normally; note `Confidence: Low`; add manual review flag |
| Artifacts missing | Note `(artifact not found)` — do not error out |
| Test title has no AC ref | Check suite JSDoc; fallback to `AC_UNKNOWN` |
| Multiple ACs in one failing test | Use most specific as primary; list all in summary |
| Same root cause across multiple Product Bug failures | Note shared root cause in summary; still generate separate files |
| Existing `issues_*.md` for same AC + Scenario | Skip creation; note as duplicate in summary |
