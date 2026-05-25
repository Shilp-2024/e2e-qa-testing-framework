# E2E QA Testing Framework

A Playwright-based end-to-end testing framework powered by a **5-agent AI pipeline** that converts a Zoho task directly into running tests — and feeds failures back into Zoho as structured bug reports. Each agent is a Claude Code instruction file in `agents/`. You run them sequentially by typing a trigger phrase.

---

## How the Pipeline Works

```
Zoho Task (ID)
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 1 — Feature Analyzer                                                 │
│  • Fetches the task from Zoho via MCP                                       │
│  • Extracts all Acceptance Criteria (ACs) and scenarios                     │
│  • Builds a UI Element Inventory (every element the tests must touch)       │
│  • Outputs a structured QA spec                                             │
│  • Runs the auto-extractor automatically (no manual step needed)            │
│  OUTPUT → features/{FeatureName}/spec/QA_{FeatureName}.md                  │
│           features/{FeatureName}/locators/extract_{FeatureName}_auto.json   │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 2 — Locator Agent                                                    │
│  • Reads the auto-extractor JSON (headless DOM crawl, no browser needed)    │
│  • Cross-checks against the spec's UI Element Inventory                     │
│  • For any missing elements (error states, post-submit banners) runs        │
│    targeted Playwright Codegen as a fallback                                │
│  • Produces a merged, validated locator map (JSON + Markdown)               │
│  OUTPUT → features/{FeatureName}/locators/                                  │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 3 — Playwright Generator                                             │
│  • Reads the QA spec + locator map                                          │
│  • Generates Page Object Models, the test suite, and test data JSON        │
│  • Tags every test (@smoke / @regression / @functional / @security)        │
│  • Uses only Codegen-verified selectors — never invents locators           │
│  OUTPUT → features/{FeatureName}/pages/, tests/, testData/                 │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      │  YOU run:  npx playwright test (see Step 4 below)
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 4 — Bug Report Generator                                             │
│  • Reads Playwright test results (JSON, JUnit, screenshots, traces)        │
│  • Classifies every failure: Product Bug / Automation Issue /               │
│    Infra Failure / Flaky                                                    │
│  • Creates individual bug report files for Product Bugs only               │
│  • Creates QA_BACKLOG.md for non-product failures                          │
│  OUTPUT → features/{FeatureName}/bugReports/                               │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 5 — Zoho MCP Agent                                                  │
│  • Reads bug report files (issues_*.md)                                    │
│  • Deduplicates against local sync log + live Zoho API                     │
│  • Creates Zoho issues for confirmed Product Bugs                          │
│  • Writes a sync report and updates zoho/sync_log.json                     │
│  OUTPUT → Zoho Project Issues + BugReports_Sync_Report_{date}.md           │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
   Zoho Issue (linked to the original task)
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- Access to the application under test
- Zoho Projects account (required for Agent 1 and Agent 5)
- Claude Code with Zoho MCP integration configured

### Installation

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browsers
npx playwright install

# 3. Configure environment
cp .env.example .env
```

Open `.env` and fill in:

| Variable | Description |
|----------|-------------|
| `BASE_URL` | URL of the application under test (e.g. `https://staging.yourapp.com`) |
| `TEST_USER_EMAIL` | QA test account email (must already exist in the app) |
| `TEST_USER_PASSWORD` | QA test account password |
| `ZOHO_API_KEY` | Zoho Bearer token (see `.env.example` for how to obtain) |
| `ZOHO_PORTAL_ID` | Numeric portal ID from Zoho Projects URL |
| `ZOHO_PROJECT_ID` | Numeric project ID from Zoho Projects URL |

---

## Project Structure

```
├── agents/                               # 5-agent pipeline instruction files
│   ├── 1_Feature_Analyzer_Agent.md       # Zoho task → QA spec
│   ├── 2_Locator_Agent.md                # Live app → locator map
│   ├── 3_Playwright_Generator_Agent.md   # Spec + locators → tests
│   ├── 4_Bug_Report_Generator_Agent.md   # Test results → bug reports
│   └── 5_Zoho_MCP_Agent.md              # Bug reports → Zoho issues
│
├── features/                             # One folder per feature
│   └── {FeatureName}/
│       ├── spec/
│       │   └── QA_{FeatureName}.md       # Agent 1 output — QA specification
│       ├── locators/
│       │   ├── extract_{Feature}_auto.json   # Headless DOM crawl (Step 0)
│       │   ├── extract_{Feature}_codegen.js  # Codegen fallback (if needed)
│       │   ├── {FeatureName}_locators.json   # Final merged locator map
│       │   └── {FeatureName}_locators.md     # Human-readable locator map
│       ├── pages/
│       │   └── {PageName}Page.ts         # Page Object Model(s)
│       ├── tests/
│       │   └── feature_{name}.spec.ts    # Playwright test suite
│       ├── testData/
│       │   └── {feature_name}.json       # Test data (valid, invalid, edge cases)
│       └── bugReports/
│           ├── issues_{Feature}_AC_XXX_SCXX.md    # One file per Product Bug
│           ├── QA_BACKLOG.md                       # Automation/Infra/Flaky issues
│           ├── BUG_REPORT_SUMMARY.md               # Full run statistics
│           └── BugReports_Sync_Report_{date}.md    # Zoho sync record
│
├── scripts/
│   └── auto_locator_extractor.js         # Headless DOM crawler (Agent 2 Step 0)
│
├── shared/
│   └── utils/
│       └── ConfigLoader.ts               # Type-safe locator + test data loader
│
├── reports/                              # Playwright output (gitignored)
│   ├── test-results/                     # Screenshots, videos, traces, JSON, JUnit
│   └── playwright-report/                # HTML report
│
├── zoho/
│   ├── config.json.example               # Zoho runtime config template
│   └── sync_log.json                     # Persistent duplicate-detection log
│
├── playwright.config.ts                  # Global timeout, browsers, reporters
├── .env.example                          # Environment variable template
└── codegen.sh                            # Codegen helper script for Agent 2 fallback
```

---

## Adding a New Feature — Step by Step

### Step 1 — Agent 1: Feature Analyzer

**Trigger in Claude Code:**
```
Run Agent 1 for Zoho task {TASK_ID}, feature {FeatureName}
```

Agent 1 connects to Zoho via MCP, fetches the full task, and produces a structured spec. It then prints the exact `npm run extract-locators` commands you need to run next.

**Output:** `features/{FeatureName}/spec/QA_{FeatureName}.md`

The spec contains:
- All Acceptance Criteria with scenarios, types, priorities, and automation feasibility
- A UI Element Inventory (the capture checklist for Agent 2)
- Risk assessment and test coverage matrix

Agent 1 also runs the auto-extractor automatically against the live app — no manual step needed.

**Auto-extractor output:** `features/{FeatureName}/locators/extract_{FeatureName}_auto.json`

---

### Step 2 — Agent 2: Locator Agent

**Trigger in Claude Code:**
```
Run Agent 2 for {FeatureName}
```

Agent 2 reads the auto-extracted JSON as its primary source. It cross-checks every element against the spec's UI Element Inventory. For any elements that the auto-extractor could not reach (error messages, post-submit banners, elements that only appear after an interaction), it runs targeted Playwright Codegen as a fallback.

**Locator source priority:**
1. Auto-extractor JSON — interactive elements (buttons, links, inputs, dropdowns), captured headlessly
2. Programmatic DOM evaluation — structural elements (headings, sections, header, footer, nav) that the auto-extractor doesn't capture
3. Playwright Codegen — dynamic elements only (error banners, post-submit states, modals)
4. Marked `MISSING` — elements that could not be captured by any source; flagged for follow-up

**Outputs:**
```
features/{FeatureName}/locators/extract_{FeatureName}_auto.json    ← headless crawl
features/{FeatureName}/locators/extract_{FeatureName}_codegen.js   ← Codegen fallback (if needed)
features/{FeatureName}/locators/{FeatureName}_locators.json        ← final merged map
features/{FeatureName}/locators/{FeatureName}_locators.md          ← human-readable map
```

If any P1 (Critical) element is still missing after both sources, Agent 2 will block and warn before handing off to Agent 3.

---

### Step 3 — Agent 3: Playwright Test Generator

**Trigger in Claude Code:**
```
Run Agent 3 for {FeatureName}
```

Agent 3 reads the QA spec and the locator map, then generates three files:

**Page Object Models** (`features/{FeatureName}/pages/{PageName}Page.ts`):
- All locators are `private readonly`
- Locator selectors come directly from the Codegen-verified locator JSON — never invented
- Navigation uses relative paths (Playwright prepends `baseURL` automatically)
- Every public method is `async` with a JSDoc comment

**Test Suite** (`features/{FeatureName}/tests/feature_{feature_name}.spec.ts`):
- Tests grouped by scenario category using `test.describe()`
- Every test title includes Scenario ID and AC reference: `'SC-1.1 | AC_001 — description'`
- Tests are tagged for filtering: `{ tag: ['@smoke', '@regression', '@functional'] }`
- Arrange / Act / Assert structure
- No hardcoded waits — Playwright waits only

**Test Data** (`features/{FeatureName}/testData/{feature_name}.json`):
- Scenarios grouped as `validUsers`, `invalidUsers`, `edgeCaseUsers`
- No production credentials

**Tag reference:**

| Tag | When applied |
|-----|-------------|
| `@smoke` | P1 Happy Path — safe to run on production |
| `@regression` | P1–P2 scenarios, every build |
| `@functional` | All automatable ACs |
| `@security` | Auth, password masking, session handling |

---

### Step 4 — Run Tests

```bash
# Single feature, Chromium (recommended for first run)
npx playwright test features/{FeatureName}/tests/ --project=chromium

# Single feature, headed (browser visible)
npx playwright test features/{FeatureName}/tests/ --project=chromium --headed

# Run and open HTML report immediately after
npm run test:report
```

> Do not pass `--reporter` on the CLI — it overrides `playwright.config.ts` and skips the JSON/JUnit reporters that Agent 4 depends on.

Results land in:
- `reports/test-results/` — screenshots, videos, and traces for failed tests; `results.json`; `junit.xml`
- `reports/playwright-report/` — interactive HTML report (inline screenshots, video playback, trace viewer)

**Viewing the report:**
```bash
npm run show-report
# or: npx playwright show-report reports/playwright-report
```

The HTML report always opens at `http://localhost:9323` regardless of pass/fail. For failed tests it shows inline screenshots, embedded video playback, and links to open traces directly in the Playwright Trace Viewer.

---

### Step 5 — Agent 4: Bug Report Generator

**Trigger in Claude Code:**
```
Run Agent 4 for {FeatureName}
```

Agent 4 reads the test results and classifies every failure:

| Classification | Definition | Destination |
|----------------|------------|-------------|
| **Product Bug** | App behaves incorrectly per the spec | Individual `issues_*.md` file → Agent 5 |
| **Automation Issue** | Test or page object is wrong | `QA_BACKLOG.md` (QA team to fix) |
| **Infra Failure** | Environment/server caused the failure | `QA_BACKLOG.md` (DevOps to investigate) |
| **Flaky Failure** | Passed on retry — race condition | `QA_BACKLOG.md` (timing investigation) |

Only Product Bugs become individual bug report files and are sent to Zoho. The others go into `QA_BACKLOG.md` for the QA team.

**Outputs:**
```
features/{FeatureName}/bugReports/issues_{FeatureName}_AC_XXX_SCXX.md  ← one per product bug
features/{FeatureName}/bugReports/QA_BACKLOG.md                         ← non-product failures
features/{FeatureName}/bugReports/BUG_REPORT_SUMMARY.md                 ← run statistics
```

---

### Step 6 — Agent 5: Zoho MCP Agent

**Trigger in Claude Code:**
```
Run Agent 5 for {FeatureName}
```

Agent 5 reads every `issues_*.md` bug report, checks for duplicates against both the local `zoho/sync_log.json` and the live Zoho API, then creates Zoho issues for confirmed Product Bugs.

**Outputs:**
```
features/{FeatureName}/bugReports/BugReports_Sync_Report_{date}.md  ← what was created/skipped
zoho/sync_log.json                                                   ← updated duplicate-detection log
```

---

## Update Mode (Existing Features)

When a Zoho task describes a **change** to a feature that already has a spec, locators, and tests, run the agents in update mode to apply minimum changes without touching passing tests.

```
Run Agent 1 update mode for {FeatureName} — task: {TASK_ID}
Run Agent 2 update mode for {FeatureName}
Run Agent 3 update mode for {FeatureName}
```

Update mode:
- **Agent 1** diffs the new task against the existing spec: new ACs are appended, modified ACs are updated in-place, removed ACs are marked (never deleted), a change log is appended, and a machine-readable `.ac_changes.json` is written
- **Agent 2** reads `.ac_changes.json` and captures only new or changed locators — existing captured locators are never overwritten
- **Agent 3** reads `.ac_changes.json` and adds new `test()` blocks, modifies only the affected tests, and wraps removed-AC tests in `test.skip()` — unchanged tests are never touched

---

## Running Tests

```bash
# All features, Chromium
npm test

# With browser visible
npm test -- --headed

# Specific browser
npm test -- --project=chromium

# Specific feature
npx playwright test features/{FeatureName}/tests/ --project=chromium

# Filter by tag
npm run test:smoke
npm run test:regression
npm run test:functional
npm run test:security

# Debug mode (opens inspector)
npm test -- --debug

# UI mode (interactive test runner with watch)
npm test -- --ui

# Run tests and open HTML report immediately after
npm run test:report

# View the HTML report from the last run (no re-run)
npm run show-report
```

The HTML report (`reports/playwright-report/`) shows pass/fail status, test durations, and — for failed tests — inline screenshots, embedded video playback, and links to open trace files in the Playwright Trace Viewer.

---

## ConfigLoader

`shared/utils/ConfigLoader.ts` provides type-safe access to locators and test data from any test file.

```typescript
import { ConfigLoader } from '../../../shared/utils/ConfigLoader';

// Get a single locator — returns "primary, fallback" selector string
const selector = ConfigLoader.getLocator('UserLogin', 'signInPage', 'usernameInput');

// Get all locators for a page
const locators = ConfigLoader.getPageLocators('UserLogin', 'signInPage');

// Get test data
const testData = ConfigLoader.loadTestData('UserLogin');
```

Locator files: `features/{FeatureName}/locators/{FeatureName}_locators.json`
Test data files: `features/{FeatureName}/testData/{featureName}.json`

---

## Timeout Configuration

All timeouts are set globally in `playwright.config.ts`:

| Setting | Value |
|---------|-------|
| Per test | 90 000 ms |
| Assertions | 90 000 ms |
| Actions | 90 000 ms |
| Navigation | 90 000 ms |

---

## Browsers

Chromium (Chrome) is the active browser. Firefox and WebKit are configured in `playwright.config.ts` but commented out for faster development runs.

```bash
# Chromium (default — active)
npm test -- --project=chromium

# To enable Firefox or WebKit, uncomment the relevant blocks in playwright.config.ts projects array
```

---

## Agent Quick Reference

| Agent | Trigger phrase | Input | Output |
|-------|---------------|-------|--------|
| 1 — Feature Analyzer | `Run Agent 1 for Zoho task {ID}, feature {Name}` | Zoho task | `spec/QA_{Name}.md` |
| 2 — Locator Agent | `Run Agent 2 for {Name}` | Spec + auto JSON + live app | `locators/` folder |
| 3 — Playwright Generator | `Run Agent 3 for {Name}` | Spec + locators | `pages/`, `tests/`, `testData/` |
| 4 — Bug Report Generator | `Run Agent 4 for {Name}` | Playwright test results | `bugReports/` folder |
| 5 — Zoho MCP | `Run Agent 5 for {Name}` | Bug report files | Zoho issues + sync report |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `BASE_URL` not set / undefined URL | Check `.env` has `BASE_URL=https://your-app.com`; verify `playwright.config.ts` loads dotenv |
| Tests timeout on page load | Verify the app is reachable at `BASE_URL`; check `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` in `.env` |
| Auto-extractor captures 0 elements | Check `BASE_URL` is correct; try `--headed` to inspect what loads |
| Selector not found in tests | Re-run Agent 1 (or Agent 2, which re-runs the extractor automatically if the auto JSON is missing) — Agent 2 merges and fills gaps |
| Tests fail on one browser only | Check for browser-specific CSS differences in the locator map |
| `ConfigLoader` error | Ensure `{FeatureName}_locators.json` exists in `features/{FeatureName}/locators/` |
| Zoho issue not created | Check `.env` Zoho credentials; run Agent 5 again; check `zoho/sync_log.json` for previous runs |
| TypeScript compile errors | Run `npx tsc --noEmit` to see all errors; check import paths are relative from `tests/` |

---

## Re-running After a Fix

Once a developer resolves a bug:

```bash
# Re-run the specific feature
npx playwright test features/{FeatureName}/tests/ --project=chromium

# If passing on one browser, run all
npx playwright test features/{FeatureName}/tests/

# Re-run Agent 4 to update the bug report summary
# Then re-run Agent 5 to update the Zoho issue status
```

---

## Security Notes

- `.env` is gitignored — never commit it
- Never hardcode credentials in test files or page objects — use `testData/*.json` and `.env` only
- Agent 5 never logs credentials to the sync report or sync log
- Bug report content is scanned for PII before being sent to Zoho — redacted with `[REDACTED]` if found
