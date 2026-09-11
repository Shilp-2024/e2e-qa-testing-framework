# Claude Code — Project Instructions

## What this project is
A 5-agent Playwright E2E QA framework for the WAP (Weatherization Assistance Program) Homeowner Portal.

**Pipeline:**
```
Agent 1 (Jira issue | document | URL → QA spec)
  → Agent 2 (live DOM → locator JSON)
    → Agent 3 (spec + locators → Playwright tests)
      → Agent 4 (test results → bug reports → all_issues/)
        → Agent 5 (all_issues/ → Jira issues via REST API)
```

## How to trigger each agent
```
Run Agent 1 for <JiraIssueKey> named "<TaskName>"      ← Jira mode
Run Agent 1 for document "<path>" named "<TaskName>"   ← Document mode
Run Agent 1 explore mode for <URL> named "<TaskName>"  ← Explore mode
Run Agent 2 for <FeatureName>
Run Agent 3 for <FeatureName>
Run Agent 4 for <FeatureName>
Run Agent 5 for <FeatureName>
```
Each agent reads `agents/{n}_*.md` for its full instructions.

## Full pipeline (unattended)
```
/e2e-runner <FeatureName> [jira <IssueKey> | document "<path>" | explore <URL>] [--stop-before-jira]
```
Runs Agents 1→5 end-to-end with no stops (see `.claude/commands/e2e-runner.md`).

**Unattended-mode policy** (applies only during `/e2e-runner`):
- Never ask the user questions mid-pipeline. The "ask the user" rule for unconfirmed features becomes: generate the test as `test.skip` with a `// NEEDS-CONFIRMATION: <what to verify>` comment, and list all such items in the final summary.
- Agent 5 runs automatically; duplicate detection and PII redaction remain mandatory. Use `--stop-before-jira` to hold issues for manual review instead.
- Permission allowlist for prompt-free runs lives in `.claude/settings.json` (shared). For fully headless runs: `claude -p "/e2e-runner <FeatureName>"`.

## Setup
1. `cp .env.example .env` — fill in `BASE_URL`, Jira credentials, test user
2. `npm install`
3. `npx playwright install chromium`

## Key rules (apply to every response)
- **No narration before tool calls** — act, don't announce
- **Short responses** — state results after changes, not before
- **Never re-read a file just written**
- **Never assume a feature is not implemented** — ask the user
- **Always run `npm run extract-locators` via Bash** — never ask the user to run it
- **Never use the Jira MCP connector** — use the REST API with `.env` credentials (unreliable in headless/unattended runs)
- **Never persist the Jira API token or its Basic-auth header to disk**
- **Redact PII with `[REDACTED]` before creating Jira issues**

## Credentials
- `.env` is gitignored — each team member needs their own Jira API token
- See `.env.example` for setup steps
- Jira project key is shared: `WAP`
- Each member generates their own `JIRA_API_TOKEN` at https://id.atlassian.com/manage-profile/security/api-tokens
