# E2E QA Testing Framework

A Playwright-based end-to-end testing framework powered by a **5-agent AI pipeline** that converts a Jira issue directly into running tests — and feeds failures back into Jira as structured bug reports.

Each agent is a Claude Code instruction file in `agents/`. Run them by typing a trigger phrase in Claude Code.

---

## Pipeline Overview

```
Jira Issue (Key)  |  Local Document  |  Live URL
                      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 1 — Feature Analyzer                                                 │
│  Trigger (Jira):     Run Agent 1 for <JiraIssueKey> named "<TaskName>"      │
│  Trigger (Document): Run Agent 1 for document "<path>" named "<TaskName>"   │
│  Trigger (Explore):  Run Agent 1 explore mode for <URL> named "<TaskName>"  │
│  • Jira mode   — fetches issue via REST API                                 │
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
│  • Runs npm run extract-locators — ONE browser session per page captures:   │
│    interactive elements (DOM scan), structural elements (headings, nav…),   │
│    dynamic elements (driven by declarative interactions.json), and          │
│    same-session uniqueness validation (matchCount per selector)             │
│  • Playwright Codegen is last-resort only (element unreachable declaratively)│
│  • Flags status: missing entries; blocks on P1 gaps                         │
│  • DOM-hash cache skips unchanged pages (.extract_cache.json; --force)      │
│  OUTPUT → features/{FeatureName}/locators/{FeatureName}_locators.json       │
│           locators/interactions.json + extract_{Feature}_auto.json (audit)  │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 3 — Playwright Generator                                             │
│  Trigger: Run Agent 3 for <FeatureName>                                     │
│  • Generates thin page objects extending shared/pages/BasePage.ts —         │
│    locators resolve at runtime (codegenForm → primary → fallback via .or()) │
│  • Generates test suite + test data JSON; never invents selectors           │
│  • Tags every test (@smoke / @regression / @functional / @security)         │
│  • Skips missing locators with // TODO(Agent2-rerun) comments               │
│  • Self-heal loop: runs the tests, reads results.json, repairs automation   │
│    failures (up to 3 rounds) before hand-off to Agent 4                     │
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
│  Agent 5 — Jira Sync Agent                                                  │
│  Trigger: Run Agent 5 for <FeatureName>                                     │
│  • Reads all_issues/issues_{FeatureName}_*.md                               │
│  • Deduplicates against sync_log.json + live Jira JQL search                │
│  • Creates Jira bug issues via REST API (API token — no MCP connector)      │
│  • Attaches the mandatory "ai-identified" label to every created issue      │
│  • Appends to jira/sync_log.json (append-only, source of truth)             │
│  OUTPUT → Jira Project Issues                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- A Jira Cloud account with API access
- Claude Code (desktop app, VS Code extension, or CLI)

### Installation

```bash
npm run setup        # one-shot: npm install + cp .env.example .env + cp jira/config.json.example jira/config.json + playwright install
```

Or step by step:

```bash
npm install
npx playwright install chromium
cp .env.example .env
cp jira/config.json.example jira/config.json   # optional — needed for Agent 5 Jira sync
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `BASE_URL` | App under test (e.g. `https://staging.yourapp.com`) |
| `SIGN_IN_URL` | Admin/portal login URL (used for admin-side features) |
| `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` | Provisioned test login for the app |
| `TEST_EMAIL_BASE` | Real monitored inbox — `generateTestEmail()` derives unique `+alias` addresses for form fills |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | From https://id.atlassian.com/manage-profile/security/api-tokens |
| `JIRA_BASE_URL` | Your Jira Cloud site root (e.g. `https://yourcompany.atlassian.net`) |
| `JIRA_PROJECT_KEY` | The project key issues live under (e.g. `WAP`) |

> See `.env.example` for the full step-by-step guide to generating an API token.

`jira/config.json` (gitignored) holds the Jira `issuetype`/`priority` names to use on create, the "AI identified" label, and the severity→priority map. Copy it from `jira/config.json.example`. It's optional: Agent 5 falls back to `.env` for the project key if the file is missing, but the type/priority/label mappings won't be applied.

---

## Project Structure

```
├── agents/                               # Agent instruction files
│   ├── 1_Feature_Analyzer_Agent.md
│   ├── 2_Locator_Agent.md
│   ├── 3_Playwright_Generator_Agent.md
│   ├── 4_Bug_Report_Generator_Agent.md
│   └── 5_Jira_Sync_Agent.md
│
├── features/                             # One folder per feature (gitignored — generated per-machine)
│   └── {FeatureName}/
│       ├── feature.config.json           # Feature bootstrap (used by Agents 2–5)
│       ├── spec/QA_{FeatureName}.md      # Agent 1 output — QA specification
│       ├── locators/
│       │   ├── {FeatureName}_locators.json   # Final locator map
│       │   ├── interactions.json             # Declarative dynamic-element triggers
│       │   └── extract_{Feature}_auto.json   # Auto-extractor audit snapshot
│       ├── pages/{PageName}Page.ts       # Thin page object (extends BasePage)
│       ├── tests/feature_{feature_name}.spec.ts  # Test suite (split into _{group}.spec.ts if large)
│       ├── testData/{feature_name}.json  # Test data
│       └── bugReports/QA_RUN_REPORT.md  # Agent 4 output
│
├── all_issues/                           # Bug report files (one per product bug)
│   └── issues_{FeatureName}_AC_XXX_SCXX.md
│
├── scripts/
│   └── auto_locator_extractor.js         # Single-session locator extractor (Agent 2)
│
├── shared/
│   ├── pages/BasePage.ts                 # Page-object base — runtime locator resolution
│   ├── utils/ConfigLoader.ts             # Locator/testData loader + codegenForm→primary→fallback .or() chain
│   ├── utils/waits.ts                    # Deterministic waits (no waitForTimeout)
│   ├── utils/timeouts.ts                 # ACTION/NAV/SETTLE timeouts (env-overridable)
│   ├── utils/testData.ts                 # generateTestEmail() — deliverable +alias emails
│   ├── assertions/common.ts              # Timeout-wrapped expect helpers
│   └── auth/                             # Opt-in global login + storageState (disabled by default)
│
├── reports/                              # Playwright output (gitignored)
│   ├── test-results/                     # Screenshots, videos, traces, JSON, JUnit
│   └── playwright-report/                # HTML report
│
├── jira/
│   ├── config.json.example               # issuetype/priority names, AI-identified label, severity→priority map
│   ├── config.json                       # Your copy (gitignored)
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
| Agent 1 | `Run Agent 1 for <JiraIssueKey> named "<TaskName>"` | Jira |
| Agent 1 | `Run Agent 1 for document "<path>" named "<TaskName>"` | Document |
| Agent 1 | `Run Agent 1 explore mode for <URL> named "<TaskName>"` | Explore |
| Agent 1 | `Run Agent 1 update mode for <FeatureName> — task: <JiraIssueKey>` | Update |
| Agent 2 | `Run Agent 2 for <FeatureName>` | Normal |
| Agent 2 | `Run Agent 2 update mode for <FeatureName>` | Update |
| Agent 2 | `Run Agent 2 for <full-url>` | URL Mode (no prior setup needed) |
| Agent 3 | `Run Agent 3 for <FeatureName>` | Normal |
| Agent 3 | `Run Agent 3 update mode for <FeatureName>` | Update |
| Agent 4 | `Run Agent 4 for <FeatureName>` | — |
| Agent 5 | `Run Agent 5 for <FeatureName>` | — |

**Update mode** applies minimum edits to existing specs, locators, and tests — unchanged scenarios are never touched. Agent 1 writes the AC diff to `features/{FeatureName}/.ac_changes.json`; Agents 2 and 3 read it to know exactly what to re-extract and regenerate.

**Agent 2 URL mode** can optionally continue the full pipeline after extraction — Agent 3 → run tests → Agent 4 — in a single run.

---

## Full Pipeline — One Command (`/e2e-runner`)

Runs Agents 1 → 5 end-to-end, unattended (no stops, no mid-run questions).

```
/e2e-runner <FeatureName> [jira <IssueKey> | document "<path>" | explore <URL>] [--stop-before-jira]
```

| Argument | Meaning |
|---|---|
| `<FeatureName>` | Required. First token. |
| `jira <IssueKey>` | Agent 1 Jira mode |
| `document "<path>"` | Agent 1 document mode |
| `explore <URL>` | Agent 1 explore mode |
| *(no source)* | If `features/{FeatureName}/` already has a spec → skip Agent 1 and start at Agent 2. No spec + no source → stop and report (the only halt point). |
| `--stop-before-jira` | Run Agents 1–4 only; leave issues staged for manual review instead of syncing to Jira. |

**Execution flow** — each stage gates the next; a failed gate is retried once, then the run stops and reports:

1. **Agent 1** → QA spec under `features/{FeatureName}/`
2. **Agent 2** → runs `npm run extract-locators`; locator JSON under `locators/`
3. **Agent 3** → generates + runs tests (`npx playwright test features/{FeatureName}/tests/ --project=chromium`); self-heals locator/timeout failures (max 2 cycles); genuine assertion failures are left for Agent 4
4. **Agent 4** → `all_issues/issues_{FeatureName}_*.md` for product bugs
5. **Agent 5** → syncs to Jira (skipped with `--stop-before-jira`); duplicate detection + PII redaction always enforced

**Unattended-mode notes:** unconfirmed features are emitted as `test.skip` with a `// NEEDS-CONFIRMATION:` comment (never asked mid-run) and listed in the final summary. For a fully headless run:

```bash
claude -p "/e2e-runner <FeatureName>"
```

See `.claude/commands/e2e-runner.md` for the full command definition.

### Agent 1 Input Modes

| Mode | AC source | Needs Jira? | Business context |
|---|---|---|---|
| Jira | PM-authored issue fetched via REST API | Yes | Full (issue description, attachments) |
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
npm run test:smoke
npm run test:regression
npm run test:functional
npm run test:security

# Headed / interactive
npx playwright test features/{FeatureName}/tests/ --headed
npm run test:ui      # Playwright UI mode
npm run test:debug   # Inspector

# Open HTML report
npm run show-report
```

> Do not pass `--reporter` on the CLI — it overrides `playwright.config.ts` and breaks the JSON/JUnit output that Agent 4 reads.

---

## Locator Sources (Agent 2)

All captured in a single browser session per page. Each locator entry records its `source` and `status`:

| `source` | Used for |
|---|---|
| `dom-scan` | Interactive elements (buttons, inputs, links) |
| `structural` | Headings, sections, nav, landmarks, images |
| `interaction` | Dynamic elements (modals, toasts, post-submit states) — driven by declarative `interactions.json` |
| `codegen` | Last resort only, when an element can't be reached declaratively |

Uncapturable elements get `status: missing` — flagged, and tests skip them with `// TODO(Agent2-rerun)`.

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

Defined in `shared/utils/timeouts.ts` — `ACTION_TIMEOUT` and `NAV_TIMEOUT` default to 90 000 ms, `SETTLE_TIMEOUT` to 5 000 ms — each overridable via `.env`. `playwright.config.ts` consumes the same values globally.

`page.waitForTimeout` is banned in generated tests — use the deterministic helpers in `shared/utils/waits.ts` (`waitForStable`, `waitForEnabled`, `waitForVisibleAny`, `waitForGone`).

---

## Sharing with a Team

Each collaborator needs their own `.env` with a personal Jira API token (the base URL/project key are shared; the email and API token are per-person).

`CLAUDE.md` is committed to the repo and loads automatically in Claude Code for anyone who clones the project — it contains the project overview, agent triggers, and key rules.

`.env` is gitignored and must never be committed.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `BASE_URL` undefined | Check `.env`; confirm `playwright.config.ts` has `import * as dotenv` at the top |
| Auto-extractor captures 0 elements | Verify `BASE_URL` is correct; try `--headed` to inspect the page |
| TypeScript errors | `npx tsc --noEmit` to list all; check import paths are relative from `tests/` |
| Agent 5 creates no issues | Confirm `all_issues/issues_{FeatureName}_*.md` files exist; check `jira/sync_log.json` for prior runs |
| Test timeout on first load | Verify app is reachable at `BASE_URL` |
