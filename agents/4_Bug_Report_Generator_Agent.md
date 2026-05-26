# Agent 4 — Bug Report Generator

## Role
Senior QA Architect / SDET. Reads Playwright test results, classifies every failure by root cause, generates developer-ready bug reports (one per product bug), a QA backlog for non-product failures, and a full run summary.

**Inputs:**
| Input | Path |
|---|---|
| Results JSON | `reports/test-results/results.json` |
| JUnit XML | `reports/test-results/junit.xml` |
| Artifacts | `reports/test-results/{folder}/` (screenshot, video, trace) |
| Feature spec | `features/{FeatureName}/spec/QA_{FeatureName}.md` |
| Test suite | `features/{FeatureName}/tests/feature_{feature_name}.spec.ts` |
| Page objects | `features/{FeatureName}/pages/{PageName}Page.ts` |

**Outputs:**
| Output | Path |
|---|---|
| Bug report (per product bug) | `features/{FeatureName}/bugReports/issues_{FeatureName}_AC_XXX_SCXX.md` |
| QA backlog | `features/{FeatureName}/bugReports/QA_BACKLOG.md` |
| Run summary | `features/{FeatureName}/bugReports/BUG_REPORT_SUMMARY.md` |

---

## Steps

### Step 1 — Collect Test Results
Scan `reports/test-results/` for failed test directories. Per failure: note screenshot/video/trace paths (mark absent if not found), extract error + stack trace from `results.json` or `junit.xml`, extract `stderr` console output, map test title to Scenario ID + AC refs via the test suite file, identify the page object method + line number.

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
| Automation Issue | `QA_BACKLOG.md` — Automation Issues section only |
| Infra Failure | `QA_BACKLOG.md` — Infra Failures section only |
| Flaky Failure | `QA_BACKLOG.md` — Flaky Tests section only |

**Duplicate check:** Before Step 3, verify no `issues_*.md` already exists for the same AC + Scenario. If it does, skip creation and note as duplicate in the summary.

### Step 3 — Generate Bug Reports (Product Bugs Only)
File: `features/{FeatureName}/bugReports/issues_{FeatureName}_AC_XXX_SCXX.md`
```markdown
# Bug Report: [Short failure description]

**Bug ID**: BR_XXX | **Status**: New | **Created**: {YYYY-MM-DD}
**Feature**: {FeatureName} | **AC**: {AC_XXX} | **Scenario**: {SC-X.X — description}
**Failure Type**: Product Bug | **Severity**: {Critical|High|Medium|Low}
**Environment**: {url} | **Browser**: {browser} | **Reproducibility**: {100%|Intermittent}

---

## Summary
{One paragraph: what was expected, what was observed, selector/assertion involved.}

## Description
- **Affected Component**: {page — element description}
- **Impact**: {what this prevents the user from doing}
- **Frequency**: {Always|Intermittent}

{Detailed explanation: selector mismatch, timeout, assertion value, DOM structure issue.}

## Pre-Conditions
- {Pre-condition 1}

## Steps to Reproduce
1. {step} … N. **Observe**: {actual behaviour}

**Test Reference:** `{test file}` · `{test title}` · Line {n} · `{PageName}.{method}()` → `{PageName}Page.ts:{n}`

## Actual Result
\`\`\`
{verbatim Playwright error output}
\`\`\`
**Screenshot:** `reports/test-results/{folder}/test-failed-1.png`

## Expected Result
{What AC requires.}

## Root Cause Analysis
**Classification Rationale:** {Why Product Bug — from Step 2.5}
{Probable causes and recommended developer fix.}

## Artifacts
| File | Location |
|---|---|
| Screenshot | `reports/test-results/{folder}/test-failed-1.png` |
| Video | `reports/test-results/{folder}/video.webm` |
| Trace | `reports/test-results/{folder}/trace.zip` |

\`\`\`bash
npx playwright show-trace "reports/test-results/{folder}/trace.zip"
\`\`\`

## References
[Spec](../spec/QA_{FeatureName}.md) · [Test](../tests/feature_{feature_name}.spec.ts#{n}) · [Page Object](../pages/{PageName}Page.ts#{n})
```

### Step 4 — Generate QA Backlog (`QA_BACKLOG.md`)
Always write this file (even with all-empty sections):
```markdown
# QA Backlog — {FeatureName}
**Date**: {YYYY-MM-DD} | **Feature**: {FeatureName}

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

### Step 5 — Generate Run Summary (`BUG_REPORT_SUMMARY.md`)
```markdown
# Bug Report Summary — {FeatureName}
**Date**: {YYYY-MM-DD} | **Feature**: {FeatureName} | **Environment**: {url} | **Browser**: {browser}

## Summary Statistics
| Total | Passed | Failed | Skipped | Flaky | Pass Rate |
|---|---|---|---|---|---|
| {N} | {N} | {N} | {N} | {N} | {X}% |

## Failure Classification
| Type | Count | Action | Owner |
|---|---|---|---|
| Product Bug | {N} | Bug reports created → Agent 5 | Dev Team |
| Automation Issue | {N} | QA Backlog | QA Team |
| Infra Failure | {N} | QA Backlog | DevOps |
| Flaky Failure | {N} | QA Backlog | QA Team |

## Product Bug Reports ({N})
### BR_{n} — {ScenarioID} | {AC_ID}
**File**: [{filename}]({filename}) | **Severity**: {sev} | **Error**: {brief desc} | **Expected**: {expected} | **Actual**: {actual}

## Passed Tests
| Scenario | AC Coverage | Duration | Status |
|---|---|---|---|
| SC-X.X — {desc} | AC_001 | {Xs} | ✅ Passed |

## Acceptance Criteria Impact
| AC | Status | Affected Scenarios | Classification |
|---|---|---|---|
| AC_001 | ✅ Verified | SC-1.1 | — |
| **AC_XXX** | **❌ Blocked** | **SC-X.X** | Product Bug |
| **AC_YYY** | **⚠️ Investigate** | **SC-X.X** | Automation Issue |

## Next Steps
1. **Agent 5** — {N} product bug(s) ready: `features/{FeatureName}/bugReports/issues_*.md`
2. **QA Team** — `QA_BACKLOG.md` ({N} automation + {N} flaky)
3. **DevOps** — `QA_BACKLOG.md` ({N} infra)
4. **Re-run**: `npx playwright test features/{FeatureName}/tests/feature_{feature_name}.spec.ts --project=chromium`
```

### Step 6 — Validate Outputs
**Bug reports:** Product Bug type only · sequential IDs (`BR_001`, …) · verbatim error in Actual Result · classification rationale present · all three artifact paths listed · `show-trace` command correct · relative reference links.
**QA Backlog:** all three sections present · every entry has rationale + recommended action · Action Items table complete.
**Summary:** stats accurate (passed + failed + skipped = total) · classification totals match failed count · AC impact covers all tested ACs.

### Step 7 — Output Confirmation
```
Agent 4 Complete.
| Type             | Count | Files |
| Product Bug      |  {N}  | {N} issues_*.md → ready for Agent 5 |
| Automation Issue |  {N}  | QA_BACKLOG.md |
| Infra Failure    |  {N}  | QA_BACKLOG.md |
| Flaky Failure    |  {N}  | QA_BACKLOG.md |

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
| Automation / Infra / Flaky → QA_BACKLOG.md only | Always |
| `page.goto` + connection error = Infra, not Product Bug | Always |
| `waitForURL` after form submit timeout = Product Bug | Always |
| Flaky requires `retryCount ≥ 1` AND eventual pass | Always |
| Bug IDs sequential within a single run | Always |
| Verbatim Playwright error in Actual Result | Always |
| Duplicate check before any `issues_*.md` creation | Always |
| `BUG_REPORT_SUMMARY.md` always overwrites existing | Always |
| `QA_BACKLOG.md` always written (even if 0 non-product failures) | Always |
| Passed tests never get bug report files | Always |

## Error Handling

| Situation | Action |
|---|---|
| `reports/test-results/` empty | Stop: "No test results found — run Playwright first." |
| Classification confidence Low | Route normally; note `Confidence: Low`; add manual review flag |
| Artifacts missing | Note `(artifact not found)` — do not error out |
| Test title has no AC ref | Check suite JSDoc; fallback to `AC_UNKNOWN` |
| Multiple ACs in one failing test | Use most specific as primary; list all in summary |
| Same root cause across multiple Product Bug failures | Note shared root cause in summary; still generate separate files |
| Existing `issues_*.md` for same AC + Scenario | Skip creation; note as duplicate in summary |
