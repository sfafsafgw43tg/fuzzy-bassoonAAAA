# Rollback UI Interaction Report

Date: 2026-10-28
Revision tested: `85285ec` — `ui: convert browser tools to floating popouts`
Browser version: `0.2.3`

## Test execution

Command:

```powershell
npm run e2e
```

The command rebuilt both apps and ran 18 real Electron Playwright tests with one worker.

Result: **15 passed, 3 failed**.

## Passed interaction coverage

The real Electron suite successfully exercised:

- OctoBrowser launcher startup in Polish.
- Profile creation dialog and payload handling.
- Trusted UI isolation and rejected privileged IPC calls.
- Profile process startup and readiness.
- Profile engine directory creation.
- Cookie queueing and live cookie import.
- Phone, personal, work, testing, private, and temporary profile start/close flows.
- Data-folder layout and plaintext-secret checks.
- OctoDetect main window startup in English.
- Android camera manager controls.
- Invalid OctoDetect audit-target rejection.

The rollback browser bundle built successfully before the tests.

## Failed tests and diagnosis

### 1. New-profile type picker selector failure

Test: `octobrowser.spec.ts:65`

The UI exposed two matching `.kind-grid:not(.browser-shell-grid)` elements: the profile-kind grid and the Electron browser-base grid. The failure is a test selector ambiguity, not proof that the button or dialog failed. The test should target the profile-kind radiogroup by role or an explicit profile-kind class.

Recommended test-only fix:

```ts
const kinds = win.getByRole('radiogroup').filter({ hasText: 'Antidetect' });
await expect(kinds).toBeVisible();
```

### 2. Baseline and strict OctoDetect audit

Test: `octodetect.spec.ts:39`

The baseline audit completed with risk `high` and score `20`. The strict audit was cancelled immediately after starting. The application log records `audit.failed | error: cancelled`, followed by the renderer target closing. This is a real stability defect in the rollback revision or its audit lifecycle, not a harmless selector problem.

Likely areas for repair: audit cancellation cleanup, probe-server lifetime, renderer/page ownership during sequential baseline and strict audits, and ensuring the audit IPC promise does not destroy the detect page.

### 3. Encrypted report listing

Test: `octodetect.spec.ts:56`

The test expected at least two stored reports but found zero because the preceding strict audit was cancelled. The encryption assertion was therefore never reached. This is downstream of failure 2, not evidence that encryption is broken.

## Runtime warnings

The Electron run emitted CSP violations from `launcher.js` for blocked inline styles. The policy correctly blocked them, but the launcher attempts to set inline styles that are not allowed by its CSP. This can cause visual or interaction failures for controls whose state depends on those styles. The rollback revision should move those styles into CSS classes or use a reviewed nonce/hash rather than weakening CSP with `unsafe-inline`.

## Conclusion

Profile creation/start/close and most launcher interactions worked in the rollback build. The build is not fully green: one test selector is ambiguous, the OctoDetect strict audit closes its renderer, and CSP blocks inline launcher styles. No claim is made that every button works until the OctoDetect lifecycle and CSP issues are repaired and the suite returns 18/18.

No profile data was deleted or changed during this test.
