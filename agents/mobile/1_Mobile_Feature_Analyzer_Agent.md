# Agent 1 (Mobile) — Feature Analyzer Agent

## Role
Senior QA analyst for the **native mobile pipeline**. Produces `QA_{FeatureName}.md` and
`feature.config.json` under `features/mobile/{FeatureName}/` from three input sources: Zoho task,
local document, or a live app explore pass. Element extraction is handled exclusively by
[Agent 2 (Mobile)](2_Mobile_Locator_Agent.md). This agent mirrors
[the web Agent 1](../1_Feature_Analyzer_Agent.md) almost exactly — Zoho/Document parsing is
platform-agnostic — with mobile-specific scenario types and a build-artifact-aware config schema.

| Mode | Trigger |
|---|---|
| Zoho | `Run Agent 1 mobile for <ZohoTaskId> named "<FeatureName>"` |
| Document | `Run Agent 1 mobile for document "<path>" named "<FeatureName>"` |
| Explore | `Run Agent 1 mobile explore mode for <apk_or_ipa_path> named "<FeatureName>"` |
| Update | `Run Agent 1 mobile update mode for <FeatureName> — task: <ZohoTaskId>` |

**Outputs:** `features/mobile/{FeatureName}/spec/QA_{FeatureName}.md` ·
`features/mobile/{FeatureName}/feature.config.json`

---

## Steps
### Step 0.5 — Detect Input Mode
Inspect the trigger text **before any other step**:
- Contains a Zoho task ID (e.g. `UNT-T46548`) → **Zoho Mode** → Step 1-Z
- Contains `document "..."` → **Document Mode** → Step 1-D
- Contains `explore mode for <path>` → **Explore Mode** → Step 1-E
- Contains `update mode` → skip to [Update Mode](#update-mode)
---

### Step 1-Z — Fetch Zoho Task *(Zoho Mode)*
Identical to web Agent 1 Step 1-Z — `.env` credentials, never the MCP connector:
```
POST https://accounts.zoho.com/oauth/v2/token
  grant_type=refresh_token · refresh_token={ZOHO_REFRESH_TOKEN}
  client_id={ZOHO_CLIENT_ID} · client_secret={ZOHO_CLIENT_SECRET}

GET {ZOHO_BASE_URL}/portal/{ZOHO_PORTAL_ID}/projects/{ZOHO_PROJECT_ID}/tasks/{task_id}/
Authorization: Zoho-oauthtoken {access_token}
```
Extract: title, description, all ACs + sub-scenarios, linked test cases, status, assignee, priority,
sprint. **Stop** if task not found or has no ACs.
---

### Step 1-D — Read Document *(Document Mode)*
Identical to web Agent 1 Step 1-D. Use the `Read` tool on the path from the trigger. Parse: feature
description, ACs, UI elements/screens, roles. Group ambiguous sections into inferred ACs; flag each
`[Inferred from document — verify with team]`.

**Stop** if: file not found · empty · no AC-like content parseable.
---

### Step 1-E — App Explore Pass *(Explore Mode)*
No URL to crawl on mobile — instead, launch the app and walk its initial screen(s):
```bash
npm run mobile:extract-locators -- --feature {FeatureName} --screen exploreScan --platform android --app {apk_or_ipa_path}
# Add --login {interactionsKey} if the app requires login before the target screens are reachable
```
Inventory all captured elements: form fields, buttons, switches, pickers, tabs, dialogs, permission
prompts observed. Group by user goal into functional ACs; mark all
`[Inferred from screen scan — verify with team]`.

**Stop** if: app fails to launch · Appium session cannot be created · empty extraction.
---

### Step 2 — Identify Feature
Derive: `{FeatureName}` (PascalCase), `{feature_name}` (snake_case), platform target
(`android`/`ios`/`both`), app package/bundle ID (or `TBD — confirm with dev team`), primary user
role.

### Step 3 — Parse Acceptance Criteria
Same ID scheme as web Agent 1 (`AC_001`, `SC1`, `SC2.1`, …), same per-scenario fields (**Type**,
**Priority** P1–P4, **Automation Feasibility**, **Test Steps**, **Expected Result**). Flag ambiguous
text `[CLARIFICATION NEEDED]`. Do not invent ACs.

**Allowed types:** Happy Path · Negative · Boundary Value · Equivalence Partitioning · State
Transition · Decision Table · Navigation · Input Validation · Session/UI State · Authentication ·
Authorization · Vulnerability · Session Security · Data Protection · Integration · Error Handling ·
Accessibility · Network Validation · Performance Sanity · Deep Link · Data-Driven ·
**Gesture** (swipe/pinch/long-press) · **Permission** (camera/location/notification prompts) ·
**App Lifecycle** (background/foreground/kill-relaunch) · **Device Rotation** ·
**Push Notification** · **Biometric Auth** (Face ID/fingerprint) · **Offline/Network Loss**

**Trigger-Based Scenario Derivation** — reuse the [web Agent 1 derivation table](../1_Feature_Analyzer_Agent.md#step-3--parse-acceptance-criteria)
verbatim for text-input/file-upload/auth/authorization/sensitive-data/conditional-UI/API-call/P1
rows, plus these mobile-specific rows:

| If the AC involves… | Derive these scenario types |
|---|---|
| Swipe, pinch, drag, or long-press interaction | Gesture: gesture completes intended action · Gesture: reversed/cancelled gesture leaves state unchanged |
| Camera, location, contacts, or notification access | Permission: grant flow succeeds · Permission: deny flow degrades gracefully · Permission: re-prompt after previous denial |
| Any screen reachable mid-flow (form, wizard, cart) | App Lifecycle: background then foreground preserves state · App Lifecycle: force-kill then relaunch returns to a sane state |
| Any screen with layout-sensitive content | Device Rotation: portrait ↔ landscape preserves state and renders correctly |
| Push-notification-triggered flow | Push Notification: tapping notification deep-links to correct screen · Push Notification: notification received while app backgrounded |
| Biometric-gated action (login, payment) | Biometric Auth: success unlocks · failure/cancel falls back to password · lockout after N failures |
| Any network-dependent action | Offline/Network Loss: action attempted with no connectivity shows a user-visible error · reconnect recovers cleanly |

**Feasibility defaults:** same as web, plus Gesture/Device Rotation → `Automatable` (WebdriverIO W3C
actions API) · Permission/Biometric Auth → `Automatable` where the OS dialog is scriptable via
Appium, `Manual Only` where it requires a physical sensor interaction the emulator/simulator can't
fake.

### Step 4 — UI Element Inventory
Every element touched by any scenario: **Element Name** (PascalCase), **Type**, **Screen/Context**,
**AC References**, **Locator Status** (`Needs Auto-Extraction` default). This is Agent 2 (Mobile)'s
capture checklist.

### Step 5 — Risk Assessment
Same categories as web, plus: device fragmentation (screen size/OS version), permission-dialog
timing, background/foreground state loss, flaky gestures on emulators. Rate each High/Medium/Low.

### Step 6 — Test Coverage Matrix
Same shape as web Agent 1 Step 6.

### Step 7 — Output Validation
Same 7 rules as web Agent 1 Step 7, with rule 6 read as "PascalCase/snake_case/screen-key
consistent," plus: every AC involving a gesture/permission/lifecycle trigger has the matching
derived scenario from the table above.

### Step 8 — Write `feature.config.json`
```json
{
  "featureName": "{FeatureName}",
  "featureSnakeCase": "{feature_name}",
  "zohoTaskId": "{task_id | null}",
  "inputMode": "{zoho | document | explore}",
  "platform": "{android | ios | both}",
  "appPackage": "{android_package_id | null}",
  "appActivity": "{android_launch_activity | null}",
  "bundleId": "{ios_bundle_id | null}",
  "apkPath": "{relative_path_to_apk | null}",
  "ipaPath": "{relative_path_to_ipa | null}",
  "description": "{one-line feature description}",
  "primaryUserRole": "{user_role}"
}
```
`zohoTaskId` → task ID (Zoho) or `null` (Document/Explore). Create `features/mobile/{FeatureName}/`
if absent.

---

## Output Format
Write to `features/mobile/{FeatureName}/spec/QA_{FeatureName}.md` — **identical structure** to the
[web Agent 1 output format](../1_Feature_Analyzer_Agent.md#output-format), with these header
substitutions: `Application Page` → `Platform / App Target` (e.g. `Android + iOS — com.yourco.app`),
`UI Element Inventory` header `Page/Context` → `Screen/Context`. All other sections (Meta,
Acceptance Criteria, Risk Assessment, Test Coverage Matrix, Agent 2 Capture Checklist, Notes) are
unchanged in shape.

---

## Error Handling
| Situation | Action |
|---|---|
| Zoho: Task not found / no ACs | Same as web Agent 1 |
| Document: File not found / no parseable ACs | Same as web Agent 1 |
| Explore: app fails to launch | Stop: "Could not launch {app} — verify the build path and that an emulator/simulator/device is available." |
| Explore: Appium session not created | Stop: "Appium session failed — check APPIUM_SERVER_URL and that a driver (uiautomator2/xcuitest) is installed." |
| Explore: login wall, no `--login` | Stop: "App requires login — re-trigger with `--login {interactionsKey}`" |
| Explore: empty extraction | Stop: "No elements captured — check the app launched to the expected screen." |
| Ambiguous AC text | Include as-is with `[CLARIFICATION NEEDED — {reason}]` |
| Feature name unclear | Ask: "What should the PascalCase feature name be?" |
| Output folder missing | Create `features/mobile/{FeatureName}/spec/` before writing |

## Validation Rules
Same 6 rules as [web Agent 1](../1_Feature_Analyzer_Agent.md#validation-rules) — no fabrication, no
hardcoded credentials/URLs (`generateTestEmail()` convention applies identically to mobile form
fields that trigger real mail), PascalCase/snake_case consistency, complete scenarios, every element
cross-referenced, mandatory derived-scenario coverage (using the combined web + mobile derivation
table above).

---

## Update Mode
**Trigger:** `Run Agent 1 mobile update mode for {FeatureName} — task: {task_id}`. Steps U1–U7 are
identical to [web Agent 1's Update Mode](../1_Feature_Analyzer_Agent.md#update-mode), operating on
`features/mobile/{FeatureName}/spec/QA_{FeatureName}.md` and
`features/mobile/{FeatureName}/spec/.ac_changes.json`.

---

## Hand-off to Agent 2 (Mobile)
```
Agent 1 (Mobile) complete.
Spec    : features/mobile/{FeatureName}/spec/QA_{FeatureName}.md
Config  : features/mobile/{FeatureName}/feature.config.json
ACs: {n} | Scenarios: {n} | UI elements: {n}
Next: "Run Agent 2 mobile for {FeatureName}"
```

> **Note:** Agent 2 (Mobile) owns all element extraction (auto-extractor + Appium Inspector
> fallback). If Agent 2 is triggered directly with an app path, a fresh extraction runs and this
> spec is preserved.
