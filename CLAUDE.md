# Claude Code — Project Instructions

## What this project is
A 5-agent Playwright E2E QA framework for the WAP (Weatherization Assistance Program) Homeowner
Portal, plus a fully separate 4-agent mobile (Appium) QA track for native Android/iOS apps that
hands off to the same Agent 5.

**Web pipeline:**
```
Agent 1 (Zoho task | document | URL → QA spec)
  → Agent 2 (live DOM → locator JSON)
    → Agent 3 (spec + locators → Playwright tests)
      → Agent 4 (test results → bug reports → all_issues/)
        → Agent 5 (all_issues/ → Zoho issues via REST API)
```

**Mobile pipeline** (`agents/mobile/`, own `shared/mobile/` toolkit, own `wdio.conf.ts` — see README's
"Mobile Pipeline Overview" section for full detail):
```
Agent 1 Mobile (Zoho task | document | app → QA spec)
  → Agent 2 Mobile (Appium session → element JSON)
    → Agent 3 Mobile (spec + elements → WebdriverIO/Mocha tests)
      → Agent 4 Mobile (test results → bug reports → all_issues/)
        → Agent 5 (same, unmodified — reads all_issues/ regardless of source pipeline)
```

## How to trigger each agent
```
Run Agent 1 for <ZohoTaskId> named "<TaskName>"        ← Zoho mode
Run Agent 1 for document "<path>" named "<TaskName>"   ← Document mode
Run Agent 1 explore mode for <URL> named "<TaskName>"  ← Explore mode
Run Agent 2 for <FeatureName>
Run Agent 3 for <FeatureName>
Run Agent 4 for <FeatureName>
Run Agent 5 for <FeatureName>
```
Each agent reads `agents/{n}_*.md` for its full instructions.

**Mobile triggers** (identical shape, `agents/mobile/{n}_*.md`):
```
Run Agent 1 mobile for <ZohoTaskId> named "<TaskName>"              ← Zoho mode
Run Agent 1 mobile for document "<path>" named "<TaskName>"         ← Document mode
Run Agent 1 mobile explore mode for <apk_or_ipa_path> named "<TaskName>"  ← Explore mode
Run Agent 2 mobile for <FeatureName>
Run Agent 3 mobile for <FeatureName>
Run Agent 4 mobile for <FeatureName>
Run Agent 5 for <FeatureName>                                        ← same agent as web
```

## Full pipeline (unattended)
```
/e2e-runner <FeatureName> [zoho <TaskId> | document "<path>" | explore <URL>] [--stop-before-zoho]
/mobile-e2e-runner <FeatureName> [zoho <TaskId> | document "<path>" | explore <apk_or_ipa_path>] --platform <android|ios|both> [--stop-before-zoho]
```
Runs Agents 1→5 end-to-end with no stops (see `.claude/commands/e2e-runner.md` and
`.claude/commands/mobile-e2e-runner.md`).

**Unattended-mode policy** (applies to both `/e2e-runner` and `/mobile-e2e-runner`):
- Never ask the user questions mid-pipeline. The "ask the user" rule for unconfirmed features becomes: generate the test as `test.skip`/`it.skip` with a `// NEEDS-CONFIRMATION: <what to verify>` comment, and list all such items in the final summary.
- Agent 5 runs automatically; duplicate detection and PII redaction remain mandatory. Use `--stop-before-zoho` to hold issues for manual review instead.
- Permission allowlist for prompt-free runs lives in `.claude/settings.json` (shared). For fully headless runs: `claude -p "/e2e-runner <FeatureName>"` or `claude -p "/mobile-e2e-runner <FeatureName> ..."`.

## Setup
1. `cp .env.example .env` — fill in `BASE_URL`, Zoho credentials, test user
2. `npm install`
3. `npx playwright install chromium`
4. *(Mobile pipeline only)* Install Appium drivers (`npx appium driver install uiautomator2` /
   `xcuitest`, or rely on the project-local npm deps), start an emulator/simulator, fill in the
   mobile `.env` vars, then `npm run mobile:appium-doctor` to sanity-check the toolchain.

## Key rules (apply to every response)
- **No narration before tool calls** — act, don't announce
- **Short responses** — state results after changes, not before
- **Never re-read a file just written**
- **Never assume a feature is not implemented** — ask the user
- **Always run `npm run extract-locators` via Bash** — never ask the user to run it
- **Always run `npm run mobile:extract-locators` via Bash** (mobile pipeline) — never ask the user to run it
- **Never use the Zoho MCP connector** — use the REST API with `.env` credentials
- **Never persist Zoho access tokens to disk**
- **Redact PII with `[REDACTED]` before creating Zoho issues**

## Credentials
- `.env` is gitignored — each team member needs their own Zoho OAuth credentials
- See `.env.example` for setup steps
- Zoho portal ID is shared: `36485097`
- Each member generates their own `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` at https://api-console.zoho.com
