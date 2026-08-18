---
description: Run the full 4-agent mobile QA pipeline (spec → elements → tests → bug reports), then hand off to the existing Agent 5, without stopping
argument-hint: /mobile-e2e-runner for <FeatureName> [zoho <TaskId> | document "<path>" | explore <apk_or_ipa_path>] --platform <android|ios|both> [--stop-before-zoho] --dangerously-skip-permissions
---

Run the complete mobile pipeline end-to-end for the feature in $ARGUMENTS. This is an **unattended
run** — do not stop between agents and do not ask the user questions. Follow the unattended-mode
policy in CLAUDE.md (identical for the mobile pipeline).

## Argument parsing
- First token = `{FeatureName}`.
- Optional source for Agent 1 (Mobile):
  - `zoho <TaskId>` → Agent 1 (Mobile) Zoho mode
  - `document "<path>"` → Agent 1 (Mobile) document mode
  - `explore <apk_or_ipa_path>` → Agent 1 (Mobile) explore mode
  - If no source is given and `features/mobile/{FeatureName}/` already contains a QA spec, **skip
    Agent 1** and start at Agent 2 (Mobile). If no spec exists and no source is given, stop and
    report — this is the only case where the pipeline may halt for input.
- `--platform <android|ios|both>` → which platform(s) Agent 2/3 (Mobile) target. Defaults to
  `feature.config.json`'s `platform` field if omitted and a config already exists.
- `--stop-before-zoho` → run Agents 1–4 (Mobile) only; end with a summary of issues ready for sync
  instead of running Agent 5.

## Pipeline (sequential, verify each gate before continuing)

1. **Agent 1 (Mobile)** — follow `agents/mobile/1_Mobile_Feature_Analyzer_Agent.md` in the mode
   determined above.
   *Gate:* QA spec file exists under `features/mobile/{FeatureName}/`.
2. **Agent 2 (Mobile)** — follow `agents/mobile/2_Mobile_Locator_Agent.md`. Run
   `npm run mobile:extract-locators` yourself via Bash, once per screen per target platform.
   *Gate:* element JSON exists under `features/mobile/{FeatureName}/locators/`.
3. **Agent 3 (Mobile)** — follow `agents/mobile/3_Appium_Generator_Agent.md`, then execute the
   generated spec:
   `npx wdio run wdio.conf.ts --spec features/mobile/{FeatureName}/tests/`
   Apply the self-healing loop from Agent 3 (Mobile)'s instructions for element/timing failures
   (max 2 heal-and-rerun cycles). Genuine assertion failures are product bugs — leave them failing
   for Agent 4 (Mobile).
   *Gate:* test run completed (pass or fail — both are valid outcomes).
4. **Agent 4 (Mobile)** — follow `agents/mobile/4_Mobile_Bug_Report_Generator_Agent.md` on the
   results.
   *Gate:* if there were failures, `all_issues/issues_{FeatureName}_*.md` files exist; if all tests
   passed, skip Agent 5 and report a clean run.
5. **Agent 5** — unless `--stop-before-zoho`: follow `agents/5_Zoho_Sync_Agent.md` **unchanged**
   (there is no separate mobile Zoho agent — it reads `all_issues/*.md` regardless of source
   pipeline). Duplicate detection and PII redaction are mandatory even in unattended mode.

## Failure handling
- If a gate fails, retry that agent's step once. If it fails again, stop the pipeline and report
  which stage failed, why, and what was completed.
- Appium/device infrastructure failures (session not created, emulator/simulator unavailable, driver
  not installed) are **not** a test-code problem — report them plainly rather than retrying the
  agent step, since retrying won't fix an unavailable device.
- Never mark a feature/flow "not implemented" — in unattended mode, generate the test as
  `it.skip` with a `// NEEDS-CONFIRMATION: <what to verify>` comment instead of asking.

## Final summary (always)
Report: agents run, platform(s) targeted, tests passed/failed/skipped, bug reports created, Zoho
issues created (with IDs) or "sync skipped", and any `NEEDS-CONFIRMATION` items the user should
review.
