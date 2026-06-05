# E2E QA Testing Framework

A Playwright-based end-to-end testing framework powered by a **5-agent AI pipeline** that converts a Zoho task directly into running tests — and feeds failures back into Zoho as structured bug reports.

Each agent is a Claude Code instruction file in `agents/`. Run them by typing a trigger phrase in Claude Code.

---

## Pipeline Overview

```
Zoho Task (ID)  |  Local Document  |  Live URL
                      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 1 — Feature Analyzer                                                 │
│  Trigger (Zoho):     Run Agent 1 for <ZohoTaskId> named "<TaskName>"        │
│  Trigger (Document): Run Agent 1 for document "<path>" named "<TaskName>"   │
│  Trigger (Explore):  Run Agent 1 explore mode for <URL> named "<TaskName>"  │
│  • Zoho mode   — fetches task via REST API                                  │
│  • Document mode — parses a local spec file (md, txt, pdf, html)            │
│  • Explore mode  — crawls the live URL and infers ACs from the DOM          │
│  • Extracts all ACs, scenarios, and UI Element Inventory                    │
│  • Derives additional test scenarios (boundary, security, accessibility…)   │
│  OUTPUT → features/{FeatureName}/spec/QA_{FeatureName}.md                   │
│           features/{FeatureName}/feature.config.json                        │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 2 — Locator Agent                                                    │
│  Trigger: Run Agent 2 for <FeatureName>                                     │
│  • Runs npm run extract-locators against the live app (headless)            │
│  • DOM-eval for structural elements (headings, sections, footer…)           │
│  • Playwright Codegen fallback for dynamic/post-interaction elements        │
│  • Flags MISSING elements; blocks on P1 gaps                                │
│  OUTPUT → features/{FeatureName}/locators/{FeatureName}_locators.json       │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 3 — Playwright Generator                                             │
│  Trigger: Run Agent 3 for <FeatureName>                                     │
│  • Generates Page Object Models, test suite, and test data JSON             │
│  • Tags every test (@smoke / @regression / @functional / @security)         │
│  • Uses only locators from the JSON — never invents selectors               │
│  • Skips MISSING locators with // TODO(Agent2-rerun) comments               │
│  OUTPUT → features/{FeatureName}/pages/, tests/, testData/                  │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      │  Run tests:  npx playwright test features/{FeatureName}/tests/
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 4 — Bug Report Generator                                             │
│  Trigger: Run Agent 4 for <FeatureName>                                     │
│  • Reads reports/test-results/ (JSON + JUnit + screenshots + traces)        │
│  • Classifies: Product Bug / Automation Issue / Infra Failure / Flaky       │
│  • Creates individual issues_*.md files for Product Bugs only               │
│  • Writes QA_RUN_REPORT.md for all other failures                           │
│  OUTPUT → all_issues/issues_{FeatureName}_*.md                              │
│           features/{FeatureName}/bugReports/QA_RUN_REPORT.md                │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 5 — Zoho Sync Agent                                                  │
│  Trigger: Run Agent 5 for <FeatureName>                                     │
│  • Reads all_issues/issues_{FeatureName}_*.md                               │
│  • Deduplicates against sync_log.json + live Zoho API                       │
│  • Creates Zoho bug issues via REST API (OAuth — no MCP connector)          │
│  • Appends to zoho/sync_log.json (append-only, source of truth)             │
│  OUTPUT → Zoho Project Issues                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- A Zoho Projects account with API access
- Claude Code (desktop app, VS Code extension, or CLI)

### Installation

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `BASE_URL` | App under test (e.g. `https://staging.yourapp.com`) |
| `ZOHO_CLIENT_ID` | From https://api-console.zoho.com → Self Client |
| `ZOHO_CLIENT_SECRET` | Same source |
| `ZOHO_REFRESH_TOKEN` | Exchange a grant code once; keep it (see `.env.example`) |
| `ZOHO_PORTAL_ID` | Numeric portal ID from your Zoho Projects URL |
| `ZOHO_PROJECT_ID` | Numeric project ID from your Zoho Projects URL |

> See `.env.example` for the full step-by-step guide to generating OAuth credentials.

---

## Project Structure

```
├── agents/                               # Agent instruction files
│   ├── 1_Feature_Analyzer_Agent.md
│   ├── 2_Locator_Agent.md
│   ├── 3_Playwright_Generator_Agent.md
│   ├── 4_Bug_Report_Generator_Agent.md
│   └── 5_Zoho_MCP_Agent.md
│
├── features/                             # One folder per feature
│   └── {FeatureName}/
│       ├── feature.config.json           # Feature bootstrap (used by Agents 2–5)
│       ├── spec/QA_{FeatureName}.md      # Agent 1 output — QA specification
│       ├── locators/
│       │   ├── extract_{Feature}_auto.json   # Auto-extractor output
│       │   └── {FeatureName}_locators.json   # Final locator map
│       ├── pages/{PageName}Page.ts       # Page Object Model(s)
│       ├── tests/feature_{name}.spec.ts  # Playwright test suite
│       ├── testData/{feature_name}.json  # Test data
│       └── bugReports/QA_RUN_REPORT.md  # Agent 4 output
│
├── all_issues/                           # Bug report files (one per product bug)
│   └── issues_{FeatureName}_AC_XXX_SCXX.md
│
├── scripts/
│   └── auto_locator_extractor.js         # Headless DOM crawler (Agent 2)
│
├── shared/utils/ConfigLoader.ts          # Type-safe locator + test data loader
│
├── reports/                              # Playwright output (gitignored)
│   ├── test-results/                     # Screenshots, videos, traces, JSON, JUnit
│   └── playwright-report/                # HTML report
│
├── zoho/
│   └── sync_log.json                     # Append-only duplicate-detection log
│
├── CLAUDE.md                             # Claude Code instructions (auto-loaded)
├── playwright.config.ts
└── .env.example
```

---

## Agent Trigger Reference

| Step | Trigger | Mode |
|---|---|---|
| Agent 1 | `Run Agent 1 for <ZohoTaskId> named "<TaskName>"` | Zoho |
| Agent 1 | `Run Agent 1 for document "<path>" named "<TaskName>"` | Document |
| Agent 1 | `Run Agent 1 explore mode for <URL> named "<TaskName>"` | Explore |
| Agent 1 | `Run Agent 1 update mode for <FeatureName> — task: <ZohoTaskId>` | Update |
| Agent 2 | `Run Agent 2 for <FeatureName>` | Normal |
| Agent 2 | `Run Agent 2 update mode for <FeatureName>` | Update |
| Agent 2 | `Run Agent 2 for <full-url>` | URL Mode (no prior setup needed) |
| Agent 3 | `Run Agent 3 for <FeatureName>` | Normal |
| Agent 3 | `Run Agent 3 update mode for <FeatureName>` | Update |
| Agent 4 | `Run Agent 4 for <FeatureName>` | — |
| Agent 5 | `Run Agent 5 for <FeatureName>` | — |

**Update mode** applies minimum edits to existing specs, locators, and tests — unchanged scenarios are never touched.

### Agent 1 Input Modes

| Mode | AC source | Needs Zoho? | Business context |
|---|---|---|---|
| Zoho | PM-authored task fetched via REST API | Yes | Full (task description, attachments) |
| Document | Parsed from a local file (`.md`, `.txt`, `.pdf`, exported HTML) | No | As rich as the document |
| Explore | Inferred from live DOM crawl | No | UI-only — hidden states may be missed |

---

## Running Tests

```bash
# Single feature
npx playwright test features/{FeatureName}/tests/ --project=chromium

# All features
npm test

# By tag
npx playwright test --grep @smoke
npx playwright test --grep @regression

# Headed (browser visible)
npx playwright test features/{FeatureName}/tests/ --headed

# Open HTML report
npm run show-report
```

> Do not pass `--reporter` on the CLI — it overrides `playwright.config.ts` and breaks the JSON/JUnit output that Agent 4 reads.

---

## Locator Source Priority (Agent 2)

| Priority | Source | Used for |
|---|---|---|
| 1 | Auto-extractor | Interactive elements (buttons, inputs, links) |
| 2 | DOM evaluation | Structural elements (headings, sections, header, footer) |
| 3 | Playwright Codegen | Dynamic elements (modals, toasts, post-submit states) |
| 4 | `MISSING` | Uncapturable — flagged, tests skip with `// TODO(Agent2-rerun)` |

---

## Test Tags

| Tag | Applied when | Safe on prod? |
|---|---|---|
| `@smoke` | P1 Happy Path | Yes |
| `@regression` | P1–P2, run on every build | Staging/CI |
| `@functional` | All automatable ACs | Staging/CI |
| `@security` | Auth, masking, session, injection | Staging |

---

## Timeouts

All set globally in `playwright.config.ts` — 90 000 ms for tests, assertions, actions, and navigation.

---

## Sharing with a Team

Each collaborator needs their own `.env` with personal Zoho OAuth credentials (the portal/project IDs are shared; the client ID, secret, and refresh token are per-person).

`CLAUDE.md` is committed to the repo and loads automatically in Claude Code for anyone who clones the project — it contains the project overview, agent triggers, and key rules.

`.env` is gitignored and must never be committed.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `BASE_URL` undefined | Check `.env`; confirm `playwright.config.ts` has `import * as dotenv` at the top |
| Auto-extractor captures 0 elements | Verify `BASE_URL` is correct; try `--headed` to inspect the page |
| TypeScript errors | `npx tsc --noEmit` to list all; check import paths are relative from `tests/` |
| Agent 5 creates no issues | Confirm `all_issues/issues_{FeatureName}_*.md` files exist; check `zoho/sync_log.json` for prior runs |
| Test timeout on first load | Verify app is reachable at `BASE_URL` |
