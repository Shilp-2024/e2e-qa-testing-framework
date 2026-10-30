---
name: qa-review
description: "Generate comprehensive QA scenarios from a user story, verify implementation against the codebase, and produce a complete QA report covering Frontend, Backend, API, Security, Accessibility, and End-to-End flows."
argument-hint: "<user story file path | user story text>"
---

# QA Lead Review

Input: $ARGUMENTS

You are acting simultaneously as:
- Senior QA Lead
- Senior Software Test Architect
- Senior Frontend Reviewer
- Senior Backend Reviewer
- Senior API Reviewer
- Senior Security Reviewer
- Senior Code Reviewer

Your objective is to perform a requirements-first QA review while minimizing token usage.

---

## Rules

### Workflow Order — Never Deviate

1. Understand the requirements.
2. Generate test scenarios.
3. Save test scenarios to a file.
4. Find only relevant implementation files.
5. Review implementation.
6. Verify each scenario against implementation.
7. Discover additional implementation issues.
8. Produce final QA report.

**Never inspect code before generating scenarios.**
**Never modify generated scenarios because of implementation.**
The implementation must be validated against the requirements — not vice versa.

### Token Optimization

- Read the user story once.
- Only inspect files related to the identified module.
- Ignore unrelated files.
- Do not explain obvious findings.
- Keep evidence concise (file + function/class + line range only).
- Never duplicate scenario descriptions in the QA report.
- Stop scanning once sufficient evidence has been collected.

---

## Phase 1 — Requirement Analysis

Read the supplied user story or file path.

Extract and list:

- **Module Name** (infer if not supplied)
- **Business Goal**
- **Functional Requirements**
- **Non-Functional Requirements**
- **Acceptance Criteria**
- **Business Rules**
- **UI Requirements**
- **API Requirements**
- **Database Requirements**
- **Security Requirements**

---

## Phase 2 — Generate Test Scenarios

Create file: `YYYY-MM-DD_<Module>.md`

Generate comprehensive scenarios across every dimension below.

### Frontend Scenarios

| Category | Coverage |
|----------|----------|
| Positive | Happy path, valid inputs, correct state transitions |
| Negative | Invalid inputs, missing required fields, disallowed actions |
| Boundary | Min/max length, zero values, exact limits |
| Edge | Concurrent actions, rapid clicks, browser back, tab refresh |
| Validation | Required fields, format checks, cross-field rules |
| UI | Label accuracy, placeholder text, button states, icons |
| Accessibility | Keyboard navigation, ARIA labels, screen reader order, focus |
| Responsive | Mobile, tablet, desktop layout breakpoints |
| Error Handling | API failures, network offline, 4xx/5xx responses |
| Loading | Spinner visibility, button disabled during in-flight request |
| State Changes | Initial, loading, success, error, empty, disabled, read-only |
| Out of Box | Special characters, unicode, emoji, pasted content, long strings |
| Whitespace | Space-only value in required fields, leading/trailing space trimming |
| Security Input | XSS payload (`<script>`), SQL/NoSQL injection strings, HTML injection per free-text field |


### Backend Scenarios

| Category | Coverage |
|----------|----------|
| Positive | Valid payloads, correct business logic, expected responses |
| Negative | Missing fields, wrong types, invalid values |
| Boundary | Min/max values, empty arrays, zero quantities |
| Edge | Duplicate submissions, concurrent requests, idempotency |
| Validation | DTO validation, required vs optional, type coercion |
| Business Rules | State machine, workflow enforcement, constraint checks |
| Authentication | Valid token, expired token, missing token, invalid token |
| Authorization | Role checks, resource ownership, access denied paths |
| Database | Constraint violations, FK checks, soft delete, audit fields |
| Transactions | Rollback on partial failure, atomicity |
| Error Handling | Exception mapping, meaningful error messages |
| Logging | Request/response logging, error logging, audit trails |
| Security | Injection, XSS, CSRF, sensitive data exposure |
| Whitespace/Trim | Space-only value accepted as non-empty, `@Transform` trim missing on `@IsString()` fields |
| Security (per field) | XSS/SQLi payload tested individually on every free-text DTO field, not just one representative field |
| Out of Box | Unexpected payload shapes, extra unknown fields |

### API Scenarios

| Category | Coverage |
|----------|----------|
| Positive | Correct method, route, body, expected 2xx response |
| Negative | Wrong method, malformed body, missing required param |
| Headers | Content-Type, Accept, Authorization, Correlation-ID |
| Authentication | Bearer token, missing auth, expired token |
| Authorization | Forbidden (403) for insufficient role |
| Request Validation | Required params, type validation, enum values |
| Response Validation | Schema consistency, correct field names, no data leakage |
| Status Codes | 200/201/204/400/401/403/404/409/422/429/500 coverage |
| Error Responses | Structured error body, error codes, human-readable messages |
| Pagination | page/limit params, total count, empty page |
| Sorting | Sort field, direction, default sort |
| Filtering | Single filter, multiple filters, invalid filter value |
| Security | SQL injection in params, path traversal, open redirect |
| Rate Limiting | Exceeding request quota, 429 response |
| Timeout | Slow upstream, client timeout behavior |
| Retry | Idempotent retries, non-idempotent protection |
| Idempotency | Duplicate POST prevention, idempotency key |

### End-to-End Scenarios

| Category | Coverage |
|----------|----------|
| Complete User Journey | Full workflow from entry to final state |
| Navigation | Page transitions, breadcrumbs, back button, deep links |
| Failure Recovery | Error then retry, partial completion, data persistence |
| API Integration | Real API responses mapped to UI state |
| Session Handling | Login, token refresh, session expiry, logout |
| Workflow Validation | Multi-step flows, state carried between steps |

### Scenario Table Format (per section)

| ID | Category | Scenario | Test Data | Expected Result | Priority |
|----|----------|----------|-----------|-----------------|----------|
| FE-001 | Positive | ... | `Fairfax High School`(if applicable) | ... | High |


Save the file before proceeding to Phase 3.

---

## Phase 3 — Locate Relevant Files

Now inspect the repository. Find only files related to the identified module.

### Frontend
- Components: `src/features/<module>/`
- Pages: `src/pages/public/` and `src/pages/private/`
- Hooks: `src/hooks/`
- Services: `src/services/`
- Validations: `src/validations/`
- Routes: `src/routes/`
- Context: `src/context/`
- Constants: `src/constants/`
- Types: `src/types/`

### Backend
- Controllers, Services, Repositories
- Models / Entities
- DTOs and Validators
- Middleware
- Configuration

### API
- Route definitions
- Request/response models
- OpenAPI spec (if present)

Ignore all files outside the identified module scope.

---

## Phase 4 — Verify Generated Scenarios

Review implementation for every scenario from Phase 2.

Assign one verdict per scenario:

- **PASS** — implementation matches expected result (evidence required)
- **FAILED** — implementation does not match (evidence required)
- **MANUAL** — cannot be determined from source code alone

Evidence format (one line per finding):
```
File: src/features/auth/LoginForm.tsx | Function: onSubmit | Line: 84
```

---

## Phase 5 — Deep Code QA Review

Beyond the generated scenarios, inspect the implementation for these code-verifiable concerns.

### Input Validation
- Required vs optional fields
- Empty, null, undefined handling
- Leading/trailing spaces and space-only values
- Trim logic present or absent
- Min/max length enforcement
- Boundary values (exactly at limit)
- Allowed character sets
- Unicode, emoji, HTML entities, script tags
- SQL injection vectors
- XSS protection
- Invalid format handling
- Duplicate value prevention

### Form Behaviour
- Validation trigger (onSubmit vs onChange vs onBlur)
- Error message clearing on correction
- Conditional validation (cross-field dependencies)
- Default values on mount
- Reset behaviour on cancel or success

### Error Messages
- Validation messages match specification
- API error messages surfaced correctly
- Unknown/unexpected errors mapped to user-friendly fallback
- Duplicate submission error handling

### UI State
- Initial state (empty/default)
- Loading state (spinner, disabled elements)
- Success state (toast, redirect, data refresh)
- Error state (inline error, toast)
- Empty state (no data)
- Disabled/read-only field handling
- Retry mechanism

### Button Behaviour
- Enable/disable rules correct
- Double-click/rapid-click prevention
- Loading indicator during API call
- Submit protection (form `noValidate` + manual guard)

### API Contract Review

**Request**
- HTTP method and route correct
- Request body schema matches backend contract
- Required vs optional parameters
- Headers: Authorization, Content-Type, Accept
- Query param and path param handling

**Response**
- Success payload schema
- Error payload structure
- Schema consistency across endpoints
- No sensitive data leakage in response

**Status Codes**
Verify correct usage of: 200, 201, 202, 204, 400, 401, 403, 404, 405, 409, 412, 415, 422, 429, 500, 502, 503, 504

### Security Headers
- Authorization / Bearer token handling
- Content-Type enforcement
- Cache-Control
- CORS configuration
- CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- Correlation ID / Trace ID propagation

### Authentication & Authorization
- Login / logout flow
- JWT validation and expiry
- Refresh token handling
- Invalid/missing token responses
- Role and permission checks
- Resource ownership enforcement
- Access denied paths

### Business Rules
- Workflow and state transitions enforced
- Duplicate prevention
- Feature flags (if applicable)
- Configuration-driven constraints

### Database (if backend accessible)
- Transaction boundaries
- Rollback on failure
- Constraint and FK enforcement
- Soft delete vs hard delete
- Audit fields (createdAt, updatedAt, createdBy)
- Unique key violations

### Security
- SQL injection in all input paths
- XSS via user-supplied content
- CSRF token validation
- Path traversal in file operations
- Open redirect prevention
- Sensitive data exposure in logs or responses
- Password hashing (never plaintext)
- Secret management (no hardcoded keys)

### Performance
- Lazy loading and code splitting
- Pagination on all list endpoints
- Query optimization (no N+1)
- Async/await correct (no blocking calls)
- Caching (React Query staleTime, HTTP cache headers)
- Large payload handling

### Logging
- Error logging with stack trace
- Audit logging for sensitive actions
- Request logging (method, path, status, duration)
- Correlation ID present
- No sensitive data (passwords, tokens) in logs

### Accessibility (from code)
- All inputs have associated `<label>` or `aria-label`
- `aria-invalid`, `aria-describedby` on error fields
- `aria-required` or `required` on mandatory inputs
- Semantic HTML (`<button>` not `<div onClick>`)
- Focus management on modal open/close
- Alt text on images
- Keyboard navigation (Tab order, Enter/Escape handling)

### Code Quality
- Dead code or unused exports
- Hardcoded strings that should be constants
- Exception handling completeness
- Null safety (no unchecked `.property` access)
- Duplicate logic that should be shared
- Code smells (overly complex conditionals, magic numbers)
- `console.*` left in production code

### Existing Tests
- Unit test coverage for validation logic
- Integration test coverage for API paths
- E2E test coverage for critical user journeys
- Missing test areas (document specifically)

---

## Phase 6 — Manual Testing Items

List only items that cannot be verified from source code.

Examples:
- Visual alignment and spacing accuracy against design
- Cross-browser compatibility (Chrome, Firefox, Safari, Edge)
- Mobile responsiveness on physical devices
- Animation smoothness and timing
- UX consistency across the module
- Real email / SMS / push notification delivery
- Third-party service integration (Stripe, OAuth, etc.)
- Production performance under load
- Screen reader behaviour (NVDA, VoiceOver)
- Color contrast ratios on actual rendered output

---

## Phase 7 — Generate Final Report

Create file: `YYYY-MM-DD_<Module>_QA_Report.md`

### Report Structure

```markdown
# QA Report — <Module Name>

**Date:** YYYY-MM-DD
**Module:** <name>
**Risk Level:** Critical | High | Medium | Low
**Overall Coverage:** X%

---

## Executive Summary

<2–3 sentence overall assessment — what works, what is broken, overall confidence level.>

---

## Scenario Verification

### Frontend
| Scenario ID | Scenario Title | Steps | Expected Result | Actual Result | Verdict | Evidence | Confidence | Evidence Tier |
|-------------|-----------------|-------|-----------------|----------------|---------|----------|------------|----------------|
| FE-001 | ... | ... | ... | ... | PASS / FAILED / MANUAL | file:line | High / Medium / Low | ... |

### Backend
| Scenario ID | Scenario Title | Steps | Expected Result | Actual Result | Verdict | Evidence | Confidence | Evidence Tier |
|-------------|-----------------|-------|-----------------|----------------|---------|----------|------------|----------------|
| BE-001 | ... | ... | ... | ... | PASS / FAILED / MANUAL | file:line | High / Medium / Low | ... |

### API
| Scenario ID | Scenario Title | Steps | Expected Result | Actual Result | Verdict | Evidence | Confidence | Evidence Tier |
|-------------|-----------------|-------|-----------------|----------------|---------|----------|------------|----------------|
| API-001 | ... | ... | ... | ... | PASS / FAILED / MANUAL | file:line | High / Medium / Low | ... |

### End-to-End
| Scenario ID | Scenario Title | Steps | Expected Result | Actual Result | Verdict | Evidence | Confidence | Evidence Tier |
|-------------|-----------------|-------|-----------------|----------------|---------|----------|------------|----------------|
| E2E-001 | ... | ... | ... | ... | PASS / FAILED / MANUAL | file:line | High / Medium / Low | ... |
---

## Scenario Summary
| Status | Count |
|--------|-------|
| PASS | N |
| FAILED | N |
| MANUAL | N |
| **Total** | N |
| **Percentage** | N |

---

## Additional Code Review Findings

Issues found during Phase 5 that were not part of the original requirements.

| No. | Bug ID | Title | Description (Steps · Expected · Actual · File:Line · Severity) |
|-----|--------|-------|----------------------------------------------------------------|

---

## Existing Test Coverage

| Type | Status | Gap |
|------|--------|-----|
| Unit Tests | Present / Absent | ... |
| Integration Tests | Present / Absent | ... |
| API Tests | Present / Absent | ... |
| E2E Tests | Present / Absent | ... |

---

## Manual Testing Required

| No. | Area | What to Verify | Priority |
|-----|------|---------------|----------|

---

## Recommendations

### Critical
- <finding> — <recommended fix>

### High
- <finding> — <recommended fix>

### Medium
- <finding> — <recommended fix>

### Low
- <finding> — <recommended fix>
```

---

## Output Contract

Generate **exactly two files**:

1. `YYYY-MM-DD_<Module>.md` — test scenarios only (Phase 2 output)
2. `YYYY-MM-DD_<Module>_QA_Report.md` — full report (Phase 7 output)

Do not generate any other files.
Do not include scenario descriptions in the QA Report body — reference by ID only.
Do not inspect code before the scenario file is saved.
