---
description: Run the full 5-agent QA pipeline (spec → locators → tests → bug reports → Zoho) without stopping
argument-hint: /e2e-runner for <FeatureName> [zoho <TaskId> | document "<path>" | explore <URL>] [--stop-before-zoho] --dangerously-skip-permissions
---

Run the complete 5-agent pipeline end-to-end for the feature in $ARGUMENTS. This is an **unattended run** — do not stop between agents and do not ask the user questions. Follow the unattended-mode policy in CLAUDE.md.

## Argument parsing
- First token = `{FeatureName}`.
- Optional source for Agent 1:
  - `zoho <TaskId>` → Agent 1 Zoho mode
  - `document "<path>"` → Agent 1 document mode
  - `explore <URL>` → Agent 1 explore mode
  - If no source is given and `features/{FeatureName}/` already contains a QA spec, **skip Agent 1** and start at Agent 2. If no spec exists and no source is given, stop and report — this is the only case where the pipeline may halt for input.
- `--stop-before-zoho` → run Agents 1–4 only; end with a summary of issues ready for sync instead of running Agent 5.

## Pipeline (sequential, verify each gate before continuing)

1. **Agent 1** — follow `agents/1_Feature_Analyzer_Agent.md` in the mode determined above.
   *Gate:* QA spec file exists under `features/{FeatureName}/`.
2. **Agent 2** — follow `agents/2_Locator_Agent.md`. Run `npm run extract-locators` yourself via Bash.
   *Gate:* locator JSON exists under `features/{FeatureName}/locators/`.
3. **Agent 3** — follow `agents/3_Playwright_Generator_Agent.md`, then execute the generated spec:
   `npx playwright test features/{FeatureName}/tests/ --project=chromium`
   Apply the self-healing loop from Agent 3's instructions for locator/timeout failures (max 2 heal-and-rerun cycles). Genuine assertion failures are product bugs — leave them failing for Agent 4.
   *Gate:* test run completed (pass or fail — both are valid outcomes).
4. **Agent 4** — follow `agents/4_Bug_Report_Generator_Agent.md` on the results.
   *Gate:* if there were failures, `all_issues/issues_{FeatureName}_*.md` files exist; if all tests passed, skip Agent 5 and report a clean run.
5. **Agent 5** — unless `--stop-before-zoho`: follow `agents/5_Zoho_Sync_Agent.md`. Duplicate detection and PII redaction are mandatory even in unattended mode.

## Failure handling
- If a gate fails, retry that agent's step once. If it fails again, stop the pipeline and report which stage failed, why, and what was completed.
- Never mark a feature/flow "not implemented" — in unattended mode, generate the test as `test.skip` with a `// NEEDS-CONFIRMATION: <what to verify>` comment instead of asking.

## Final summary (always)
Report: agents run, tests passed/failed/skipped, bug reports created, Zoho issues created (with IDs) or "sync skipped", and any `NEEDS-CONFIRMATION` items the user should review.
