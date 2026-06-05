# Claude Code — Project Instructions

## What this project is
A 5-agent Playwright E2E QA framework for the WAP (Weatherization Assistance Program) Homeowner Portal.

**Pipeline:**
```
Agent 1 (Zoho task | document | URL → QA spec)
  → Agent 2 (live DOM → locator JSON)
    → Agent 3 (spec + locators → Playwright tests)
      → Agent 4 (test results → bug reports → all_issues/)
        → Agent 5 (all_issues/ → Zoho issues via REST API)
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

## Setup
1. `cp .env.example .env` — fill in `BASE_URL`, Zoho credentials, test user
2. `npm install`
3. `npx playwright install chromium`

## Key rules (apply to every response)
- **No narration before tool calls** — act, don't announce
- **Short responses** — state results after changes, not before
- **Never re-read a file just written**
- **Never assume a feature is not implemented** — ask the user
- **Always run `npm run extract-locators` via Bash** — never ask the user to run it
- **Never use the Zoho MCP connector** — use the REST API with `.env` credentials
- **Never persist Zoho access tokens to disk**
- **Redact PII with `[REDACTED]` before creating Zoho issues**

## Credentials
- `.env` is gitignored — each team member needs their own Zoho OAuth credentials
- See `.env.example` for setup steps
- Zoho portal ID is shared: `36485097`
- Each member generates their own `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` at https://api-console.zoho.com
