# Setup Guide — Adding a New Feature

This guide walks through the complete process of adding a new feature to the framework
using the 5-agent pipeline. Follow these steps for every new Zoho task.

---

## Prerequisites

Before starting:
- [ ] `.env` is configured with `BASE_URL` pointing to the target application
- [ ] Zoho credentials (`ZOHO_API_KEY`, `ZOHO_PORTAL_ID`, `ZOHO_PROJECT_ID`) are set in `.env`
- [ ] The application is accessible at `BASE_URL`
- [ ] You have the Zoho task ID (e.g. `UNT-T46548`)
- [ ] You have decided on the PascalCase feature name (e.g. `PatientManagement`)

---

## Step 1 — Agent 1: Feature Analyzer

**Trigger in Claude Code:**
```
Run Agent 1 for Zoho task {TASK_ID}, feature {FeatureName}
```

**What it does:**
- Fetches the full task from Zoho including all acceptance criteria
- Produces a structured QA specification

**Output:**
```
features/{FeatureName}/spec/QA_{FeatureName}.md
```

**Verify:**
- Open `features/{FeatureName}/spec/QA_{FeatureName}.md`
- Confirm all ACs from the Zoho task are captured
- Check the UI Element Inventory table — these are the elements Agent 2 will capture

---

## Step 2 — Agent 2: Locator Capture (Auto-Extractor + Codegen Fallback)

**First, run the auto-extractor for each page (Agent 1 prints the exact commands):**
```bash
# Unauthenticated pages:
npm run extract-locators -- --feature {FeatureName} --page {pageName} --url {relativeUrl}

# Pages that require login first:
npm run extract-locators -- --feature {FeatureName} --page {pageName} --url {relativeUrl} --login /Account/SignIn
```

Run once per page — outputs merge automatically into one JSON file. This captures all
static elements (inputs, buttons, links, checkboxes) headlessly with no browser interaction needed.

**Then trigger Agent 2 in Claude Code:**
```
Run Agent 2 for {FeatureName}
```

**What it does:**
- Step 0: Reads the auto-extracted JSON as the primary source
- Cross-checks against the spec UI Element Inventory — builds a missing-elements list
- If anything is missing (error states, post-submit banners), runs targeted Codegen for those elements only
- Produces the final merged locator map

**Outputs:**
```
features/{FeatureName}/locators/extract_{FeatureName}_auto.json    ← auto-extractor draft (Step 0)
features/{FeatureName}/locators/extract_{FeatureName}_codegen.js   ← Codegen fallback (only if needed)
features/{FeatureName}/locators/{FeatureName}_locators.json        ← final merged locator map
features/{FeatureName}/locators/{FeatureName}_locators.md          ← human-readable map
```

**Verify:**
- Check `{FeatureName}_locators.json` — `status: "captured"` for all critical elements
- Note any `status: "missing"` entries — re-run the extractor or trigger a targeted Codegen session

---

## Step 3 — Agent 3: Playwright Test Generator

**Trigger in Claude Code:**
```
Run Agent 3 for {FeatureName}
```

**What it does:**
- Reads the QA spec and locator map
- Generates Page Object Models, test suite, and test data JSON
- Marks placeholder assertions with `// TODO(Agent2-rerun)` where locators are missing

**Outputs:**
```
features/{FeatureName}/pages/{PageName}Page.ts         ← Page Object Model(s)
features/{FeatureName}/tests/feature_{name}.spec.ts    ← Playwright test suite
features/{FeatureName}/testData/{name}.json            ← Test data
```

**Verify:**
```bash
# Compile TypeScript — should produce no errors
npx tsc --noEmit

# Run the new tests on Chromium only first
npx playwright test features/{FeatureName}/tests/ --project=chromium --headed
```

---

## Step 4 — Run Tests & Generate Bug Reports

**Run the full test suite:**
```bash
npx playwright test features/{FeatureName}/tests/ --reporter=html,json,junit
```

Results land in:
- `reports/test-results/` — screenshots, videos, traces, `results.json`, `junit.xml`
- `reports/playwright-report/` — HTML report

```bash
# Open HTML report
npx playwright show-report reports/playwright-report
```

**Then trigger Agent 4 in Claude Code:**
```
Run Agent 4 for {FeatureName}
```

**What it does:**
- Classifies every failure: Product Bug / Automation Issue / Infra Failure / Flaky
- Creates individual bug report files for Product Bugs only
- Creates `QA_BACKLOG.md` for Automation Issues, Infra Failures, and Flaky tests
- Creates a full run summary

**Outputs:**
```
features/{FeatureName}/bugReports/issues_{FeatureName}_AC_XXX_SCXX.md   ← one per product bug
features/{FeatureName}/bugReports/QA_BACKLOG.md                          ← non-product failures
features/{FeatureName}/bugReports/BUG_REPORT_SUMMARY.md                  ← run summary
```

---

## Step 5 — Agent 5: Sync to Zoho

**Trigger in Claude Code:**
```
Run Agent 5 for {FeatureName}
```

**What it does:**
- Reads all `issues_*.md` bug report files
- Checks for duplicates (local log + Zoho API)
- Creates Zoho issues for confirmed Product Bugs
- Writes sync report and updates `zoho/sync_log.json`

**Outputs:**
```
features/{FeatureName}/bugReports/BugReports_Sync_Report_{date}.md
zoho/sync_log.json
```

**Verify:**
- Open Zoho Projects → your project → Issues tab
- Confirm new issues are visible with correct titles and severity

---

## Folder Structure After Completing All 5 Steps

```
features/
  {FeatureName}/
    spec/
      QA_{FeatureName}.md               ← Agent 1
    locators/
      extract_{FeatureName}_auto.json   ← Agent 2 Step 0 (auto-extractor draft)
      extract_{FeatureName}_codegen.js  ← Agent 2 (Codegen fallback — only if needed)
      {FeatureName}_locators.json       ← Agent 2 (final merged map)
      {FeatureName}_locators.md         ← Agent 2
    pages/
      {PageName}Page.ts                 ← Agent 3
    tests/
      feature_{feature_name}.spec.ts    ← Agent 3
    testData/
      {feature_name}.json               ← Agent 3
    bugReports/
      issues_{FeatureName}_AC_XXX_SCXX.md  ← Agent 4 (per product bug)
      QA_BACKLOG.md                        ← Agent 4
      BUG_REPORT_SUMMARY.md                ← Agent 4
      BugReports_Sync_Report_{date}.md     ← Agent 5
```

---

## Re-running After a Fix

Once a developer resolves a bug:

```bash
# Re-run the specific feature tests
npx playwright test features/{FeatureName}/tests/ --project=chromium

# If passing, run all browsers
npx playwright test features/{FeatureName}/tests/

# Run Agent 4 again to update the bug report summary
# Then run Agent 5 again to update the Zoho issue status
```

---

## Common Commands Reference

```bash
# Run all features, all browsers
npm test

# Run one feature, one browser
npx playwright test features/{FeatureName}/tests/ --project=chromium

# Run with browser visible
npm test -- --headed

# Open Playwright UI mode
npm test -- --ui

# Show HTML report
npx playwright show-report reports/playwright-report

# Auto-extract locators for a page (run once per page)
npm run extract-locators -- --feature {FeatureName} --page {pageName} --url {relativeUrl}

# Codegen fallback — for dynamic elements Agent 2 could not auto-capture
./codegen.sh {FeatureName} chromium

# TypeScript check
npx tsc --noEmit
```
