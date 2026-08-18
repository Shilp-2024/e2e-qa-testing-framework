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
│  Agent 5 — Zoho Sync Agent                                                  │
│  Trigger: Run Agent 5 for <FeatureName>                                     │
│  • Reads all_issues/issues_{FeatureName}_*.md                               │
│  • Deduplicates against sync_log.json + live Zoho API                       │
│  • Creates Zoho bug issues via REST API (OAuth — no MCP connector)          │
│  • Attaches the mandatory "AI identified" tag to every created issue        │
│  • Appends to zoho/sync_log.json (append-only, source of truth)             │
│  OUTPUT → Zoho Project Issues                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Mobile Pipeline Overview (Appium)

A **fully separate 4-agent track** for native mobile app testing (Android `.apk` / iOS `.ipa`) sits
alongside the web pipeline above — own agent docs (`agents/mobile/`), own shared toolkit
(`shared/mobile/`), own WebdriverIO/Appium test runner (`wdio.conf.ts`), own reports directory
(`reports/mobile/`). It shares no Playwright code, but mirrors the same locator-JSON field names,
bug-report format, and hand-off style. **Agent 5 (Zoho Sync) is reused unchanged** — bug reports
from either pipeline land in the same `all_issues/` folder in the same markdown shape.

```
Zoho Task (ID)  |  Local Document  |  App (.apk / .ipa)
                      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 1 (Mobile) — Feature Analyzer                                        │
│  Trigger (Zoho):     Run Agent 1 mobile for <ZohoTaskId> named "<Name>"     │
│  Trigger (Document): Run Agent 1 mobile for document "<path>" named "<Name>"│
│  Trigger (Explore):  Run Agent 1 mobile explore mode for <apk/ipa> named…   │
│  OUTPUT → features/mobile/{FeatureName}/spec/QA_{FeatureName}.md            │
│           features/mobile/{FeatureName}/feature.config.json                 │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 2 (Mobile) — Locator Agent                                           │
│  Trigger: Run Agent 2 mobile for <FeatureName>                              │
│  • Runs npm run mobile:extract-locators — ONE Appium session per screen     │
│    captures interactive + structural elements, dynamic elements (via        │
│    declarative interactions.json), same-session matchCount validation       │
│  • Appium Inspector is last-resort only (element unreachable declaratively) │
│  OUTPUT → features/mobile/{FeatureName}/locators/{FeatureName}_locators.json│
└─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 3 (Mobile) — Appium Test Generator                                   │
│  Trigger: Run Agent 3 mobile for <FeatureName>                              │
│  • Generates thin screen objects extending shared/mobile/screens/BaseScreen │
│  • Generates Mocha test suite + test data; tags embedded in it() titles     │
│  • Self-heal loop: runs the tests, reads results.json, repairs failures     │
│  OUTPUT → features/mobile/{FeatureName}/screens/, tests/, testData/         │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      │  Run tests:  npx wdio run wdio.conf.ts --spec features/mobile/{FeatureName}/tests/
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 4 (Mobile) — Bug Report Generator                                    │
│  Trigger: Run Agent 4 mobile for <FeatureName>                              │
│  • Reads reports/mobile/test-results/ (merged JSON + JUnit + screenshots)   │
│  • Classifies: Product Bug / Automation Issue / Infra Failure / Flaky       │
│  OUTPUT → all_issues/issues_{FeatureName}_*.md (same folder as web)         │
│           features/mobile/{FeatureName}/bugReports/QA_RUN_REPORT.md         │
└─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
     Agent 5 — Zoho Sync Agent (existing, unmodified — see pipeline above)
```

### Mobile Setup — Prerequisites & Environment

Everything below is in addition to the web prerequisites (Node.js, Zoho access). Android and iOS
setup are independent — skip whichever platform you're not testing.

**1. Java (required by the Android SDK toolchain)** — any JDK 17+:
```bash
brew install openjdk        # macOS; confirm with `java -version`
```

**2. Android SDK** — easiest path is Android Studio (bundles the SDK, platform-tools, emulator,
and a GUI AVD manager): https://developer.android.com/studio. Command-line-only setups need the
SDK's `cmdline-tools`, then `sdkmanager` to fetch `platform-tools`, `emulator`,
`platforms;android-XX`, `system-images;android-XX;google_apis;arm64-v8a`, `build-tools;XX.0.0`.

**3. Export Android environment variables** — add to `~/.zshrc` (or `~/.bash_profile`), then open a
new terminal (or `source` the file):
```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin
```
Confirm with `adb devices` (should run with no error, even with zero devices attached) and
`emulator -list-avds`.

**4. Create an emulator (AVD)** — via Android Studio: Tools → Device Manager → Create Device → pick
a Pixel profile → pick a system image (use a **Google APIs**/Play image if the app under test
depends on Play Services) → Finish. Command-line equivalent:
```bash
avdmanager create avd -n <AvdName> -k "system-images;android-XX;google_apis;arm64-v8a" -d pixel
```

**5. Start the emulator before running any mobile agent or test** — it must already be running and
attached; nothing in this pipeline boots one for you:
```bash
emulator -avd <AvdName> &
adb wait-for-device
adb devices          # must show "emulator-XXXX  device" before proceeding
```

**6. iOS only** — install Xcode + command-line tools (`xcode-select --install`), then boot a
simulator before running tests:
```bash
open -a Simulator
```

**7. Install Appium drivers and sanity-check the toolchain:**
```bash
npm install                                       # installs webdriverio/appium/wdio deps too
npx appium driver install uiautomator2            # Android — or rely on the project-local npm dep
npx appium driver install xcuitest                # iOS — or rely on the project-local npm dep
npm run mobile:appium-doctor                       # sanity-check the toolchain
```

**8. Fill in the mobile `.env` vars** — see `.env.example` for the full reference:

| Variable | Description |
|---|---|
| `APPIUM_SERVER_URL` | Informational — `wdio.conf.ts` starts/stops its own local Appium service automatically |
| `ANDROID_APK_PATH` | Path to a fresh `.apk` to install — takes priority over the package/activity pair below |
| `ANDROID_APP_PACKAGE` / `ANDROID_APP_ACTIVITY` | Used instead of `ANDROID_APK_PATH` when the app is already installed on the device |
| `ANDROID_DEVICE_NAME` / `ANDROID_PLATFORM_VERSION` | Must match the AVD created in step 4 |
| `IOS_APP_PATH` | `.app` bundle — **simulators only** |
| `IOS_IPA_PATH` | Signed `.ipa` — **real devices only**, not interchangeable with `IOS_APP_PATH` |
| `IOS_BUNDLE_ID` | Used instead of either path when the app is already installed |
| `IOS_DEVICE_NAME` / `IOS_PLATFORM_VERSION` / `IOS_UDID` | `IOS_UDID` required for real devices, optional for simulators |
| `MOBILE_TEST_USER_EMAIL` / `MOBILE_TEST_USER_PASSWORD` | Test account credentials used by generated login flows |

**9. Verify the full chain works end-to-end:**
```bash
adb devices                          # device/emulator attached
npm run mobile:appium-doctor         # Appium + drivers healthy
npx wdio run ./wdio.conf.ts --spec ./features/mobile/<Feature>/tests/feature_<feature>.spec.ts --mochaOpts.grep @smoke
```

**Mobile Agent Trigger Reference:**

| Step | Trigger | Mode |
|---|---|---|
| Agent 1 (Mobile) | `Run Agent 1 mobile for <ZohoTaskId> named "<Name>"` | Zoho |
| Agent 1 (Mobile) | `Run Agent 1 mobile for document "<path>" named "<Name>"` | Document |
| Agent 1 (Mobile) | `Run Agent 1 mobile explore mode for <apk_or_ipa_path> named "<Name>"` | Explore |
| Agent 1 (Mobile) | `Run Agent 1 mobile update mode for <FeatureName> — task: <ZohoTaskId>` | Update |
| Agent 2 (Mobile) | `Run Agent 2 mobile for <FeatureName>` | Normal |
| Agent 2 (Mobile) | `Run Agent 2 mobile update mode for <FeatureName>` | Update |
| Agent 2 (Mobile) | `Run Agent 2 mobile for <apk_or_ipa_path>` | App Mode (no prior setup needed) |
| Agent 3 (Mobile) | `Run Agent 3 mobile for <FeatureName>` | Normal |
| Agent 3 (Mobile) | `Run Agent 3 mobile update mode for <FeatureName>` | Update |
| Agent 4 (Mobile) | `Run Agent 4 mobile for <FeatureName>` | — |
| Agent 5 | `Run Agent 5 for <FeatureName>` | — (existing, unmodified) |

**Full mobile pipeline — one command:**
```
/mobile-e2e-runner <FeatureName> [zoho <TaskId> | document "<path>" | explore <apk_or_ipa_path>] --platform <android|ios|both> [--stop-before-zoho]
```
Same unattended-mode policy and gate-per-stage structure as `/e2e-runner` — see
`.claude/commands/mobile-e2e-runner.md`.

Running tests directly:
```bash
npx wdio run wdio.conf.ts --spec features/mobile/{FeatureName}/tests/feature_{feature_name}.spec.ts
npm run mobile:test                 # all mobile features
npm run mobile:test:smoke           # --mochaOpts.grep @smoke
```
> Do not pass `--reporter`/override reporter options on the CLI — `wdio.conf.ts`'s `onComplete` merge
> step is what produces the single `results.json` Agent 4 (Mobile) reads.

---

## Quick Start

### Prerequisites

- Node.js 18+
- A Zoho Projects account with API access
- Claude Code (desktop app, VS Code extension, or CLI)
- *(Mobile pipeline only)* Appium 2.x, an Android emulator or iOS simulator, Xcode (iOS) / Android SDK (Android) — see "Mobile Setup — Prerequisites & Environment" above

### Installation

```bash
npm run setup        # one-shot: npm install + cp .env.example .env + cp zoho/config.json.example zoho/config.json + playwright install
```

Or step by step:

```bash
npm install
npx playwright install chromium
cp .env.example .env
cp zoho/config.json.example zoho/config.json   # optional — needed for Agent 5 Zoho sync
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `BASE_URL` | App under test (e.g. `https://staging.yourapp.com`) |
| `SIGN_IN_URL` | Admin/portal login URL (used for admin-side features) |
| `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` | Provisioned test login for the app |
| `TEST_EMAIL_BASE` | Real monitored inbox — `generateTestEmail()` derives unique `+alias` addresses for form fills |
| `ZOHO_CLIENT_ID` | From https://api-console.zoho.com → Self Client |
| `ZOHO_CLIENT_SECRET` | Same source |
| `ZOHO_REFRESH_TOKEN` | Exchange a grant code once; keep it (see `.env.example`) |
| `ZOHO_PORTAL_ID` | Numeric portal ID from your Zoho Projects URL |
| `ZOHO_PROJECT_ID` | Numeric project ID from your Zoho Projects URL |
| `ZOHO_BASE_URL` | Zoho Projects API base (e.g. `https://projectsapi.zoho.com`) |

> See `.env.example` for the full step-by-step guide to generating OAuth credentials.

`zoho/config.json` (gitignored) holds Zoho picklist IDs — severity/classification, the AI-identified tag, and the severity map. Copy it from `zoho/config.json.example`. It's optional: Agent 5 falls back to `.env` for portal/project IDs if the file is missing, but the picklist and tag mappings won't be applied.

---

## Project Structure

```
├── agents/                               # Agent instruction files
│   ├── 1_Feature_Analyzer_Agent.md
│   ├── 2_Locator_Agent.md
│   ├── 3_Playwright_Generator_Agent.md
│   ├── 4_Bug_Report_Generator_Agent.md
│   ├── 5_Zoho_Sync_Agent.md              # Reused unchanged by the mobile pipeline too
│   └── mobile/                           # Mobile (Appium) pipeline — Agents 1-4 only
│       ├── 1_Mobile_Feature_Analyzer_Agent.md
│       ├── 2_Mobile_Locator_Agent.md
│       ├── 3_Appium_Generator_Agent.md
│       └── 4_Mobile_Bug_Report_Generator_Agent.md
│
├── features/                             # One folder per feature (gitignored — generated per-machine)
│   ├── {FeatureName}/                    # Web features
│   │   ├── feature.config.json           # Feature bootstrap (used by Agents 2–5)
│   │   ├── spec/QA_{FeatureName}.md      # Agent 1 output — QA specification
│   │   ├── locators/
│   │   │   ├── {FeatureName}_locators.json   # Final locator map
│   │   │   ├── interactions.json             # Declarative dynamic-element triggers
│   │   │   └── extract_{Feature}_auto.json   # Auto-extractor audit snapshot
│   │   ├── pages/{PageName}Page.ts       # Thin page object (extends BasePage)
│   │   ├── tests/feature_{feature_name}.spec.ts  # Test suite (split into _{group}.spec.ts if large)
│   │   ├── testData/{feature_name}.json  # Test data
│   │   └── bugReports/QA_RUN_REPORT.md  # Agent 4 output
│   └── mobile/{FeatureName}/             # Mobile features — same shape, screens/ instead of pages/
│       ├── feature.config.json           # + platform, appPackage/appActivity, bundleId, apkPath/ipaPath
│       ├── spec/QA_{FeatureName}.md
│       ├── locators/{FeatureName}_locators.json, interactions.json, extract_{Feature}_mobile_auto.json
│       ├── screens/{ScreenName}Screen.ts # Thin screen object (extends BaseScreen)
│       ├── tests/feature_{feature_name}.spec.ts
│       ├── testData/{feature_name}.json
│       └── bugReports/QA_RUN_REPORT.md
│
├── all_issues/                           # Bug report files (one per product bug — web AND mobile)
│   └── issues_{FeatureName}_AC_XXX_SCXX.md
│
├── scripts/
│   ├── auto_locator_extractor.js         # Single-session locator extractor (Agent 2)
│   └── mobile/auto_element_extractor.js  # Single-session Appium element extractor (Agent 2 Mobile)
│
├── shared/
│   ├── pages/BasePage.ts                 # Page-object base — runtime locator resolution
│   ├── utils/ConfigLoader.ts             # Locator/testData loader + codegenForm→primary→fallback .or() chain
│   ├── utils/waits.ts                    # Deterministic waits (no waitForTimeout)
│   ├── utils/timeouts.ts                 # ACTION/NAV/SETTLE timeouts (env-overridable)
│   ├── utils/testData.ts                 # generateTestEmail() — deliverable +alias emails (reused by mobile)
│   ├── assertions/common.ts              # Timeout-wrapped expect helpers
│   ├── auth/                             # Opt-in global login + storageState (disabled by default)
│   └── mobile/                           # Mobile toolkit — zero Playwright dependency
│       ├── screens/BaseScreen.ts         # Screen-object base — runtime element resolution
│       ├── utils/MobileConfigLoader.ts   # codegenForm→primary→platform-fallback→shared-fallback resolver
│       ├── utils/waits.ts, timeouts.ts
│       └── assertions/common.ts
│
├── reports/                              # Test runner output (gitignored)
│   ├── test-results/                     # Playwright: screenshots, videos, traces, JSON, JUnit
│   ├── playwright-report/                # Playwright HTML report
│   └── mobile/                           # WebdriverIO/Appium
│       ├── test-results/                 # Merged results.json, junit.xml
│       └── screenshots/                  # Failure screenshots
│
├── zoho/
│   ├── config.json.example               # Picklist IDs (severity/classification), AI-identified tag, severity map
│   ├── config.json                       # Your copy (gitignored)
│   └── sync_log.json                     # Append-only duplicate-detection log (shared by both pipelines)
│
├── CLAUDE.md                             # Claude Code instructions (auto-loaded)
├── playwright.config.ts
├── wdio.conf.ts                           # Mobile (Appium) test runner config
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

**Update mode** applies minimum edits to existing specs, locators, and tests — unchanged scenarios are never touched. Agent 1 writes the AC diff to `features/{FeatureName}/.ac_changes.json`; Agents 2 and 3 read it to know exactly what to re-extract and regenerate.

**Agent 2 URL mode** can optionally continue the full pipeline after extraction — Agent 3 → run tests → Agent 4 — in a single run.

---

## Full Pipeline — One Command (`/e2e-runner`)

Runs Agents 1 → 5 end-to-end, unattended (no stops, no mid-run questions).

```
/e2e-runner <FeatureName> [zoho <TaskId> | document "<path>" | explore <URL>] [--stop-before-zoho]
```

| Argument | Meaning |
|---|---|
| `<FeatureName>` | Required. First token. |
| `zoho <TaskId>` | Agent 1 Zoho mode |
| `document "<path>"` | Agent 1 document mode |
| `explore <URL>` | Agent 1 explore mode |
| *(no source)* | If `features/{FeatureName}/` already has a spec → skip Agent 1 and start at Agent 2. No spec + no source → stop and report (the only halt point). |
| `--stop-before-zoho` | Run Agents 1–4 only; leave issues staged for manual review instead of syncing to Zoho. |

**Execution flow** — each stage gates the next; a failed gate is retried once, then the run stops and reports:

1. **Agent 1** → QA spec under `features/{FeatureName}/`
2. **Agent 2** → runs `npm run extract-locators`; locator JSON under `locators/`
3. **Agent 3** → generates + runs tests (`npx playwright test features/{FeatureName}/tests/ --project=chromium`); self-heals locator/timeout failures (max 2 cycles); genuine assertion failures are left for Agent 4
4. **Agent 4** → `all_issues/issues_{FeatureName}_*.md` for product bugs
5. **Agent 5** → syncs to Zoho (skipped with `--stop-before-zoho`); duplicate detection + PII redaction always enforced

**Unattended-mode notes:** unconfirmed features are emitted as `test.skip` with a `// NEEDS-CONFIRMATION:` comment (never asked mid-run) and listed in the final summary. For a fully headless run:

```bash
claude -p "/e2e-runner <FeatureName>"
```

See `.claude/commands/e2e-runner.md` for the full command definition.

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
| *(Mobile)* Appium session not created | Run `npm run mobile:appium-doctor`; confirm an emulator/simulator/device is running and `APPIUM_SERVER_URL` is correct |
| *(Mobile)* `Neither ANDROID_HOME nor ANDROID_SDK_ROOT ... exported` | New terminal/session didn't pick up shell profile changes — re-`source ~/.zshrc` or open a fresh terminal; confirm with `echo $ANDROID_HOME` |
| *(Mobile)* `adb devices` shows nothing / emulator disconnects mid-run | Emulator process died (check `ps aux \| grep qemu-system`) — usually from extended heavy churn (many rapid app terminate/relaunch cycles); restart it with `emulator -avd <AvdName> &` and `adb wait-for-device` |
| *(Mobile)* Element extractor captures 0 elements | Confirm `navigateSteps` actually reach the target screen — check with Appium Inspector |
| *(Mobile)* `results.json` missing/stale | Confirm `wdio.conf.ts`'s `onComplete` merge step ran — `@wdio/json-reporter` writes one file per session by default |
