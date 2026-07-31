# PR Review: #108 — feat(login): usernameless passkey sign-in

**Reviewed**: 2026-07-31
**Author**: yahya
**Branch**: feat/usernameless-passkey-login → main
**Focus**: code efficiency, code structure, clean code (per request)
**Decision**: APPROVE-equivalent (posted as COMMENT — self-authored PR)

## Summary

Two well-scoped commits (feat 28 files / test 25 files). Structure follows the
repo's route/resource/hook layering; the shared mint block extraction
(`armUserBoundChallenge`) is the right seam and both callers read cleanly.
No CRITICAL or HIGH findings. Two MEDIUMs worth fixing before production,
six LOWs recorded for follow-up.

## Findings

### CRITICAL — None

### HIGH — None

### MEDIUM

1. **Efficiency — `passkey-discover.tsx:67-79`: provider call before the cheap
   guard.** `listAuthMethods` (Zitadel round-trip) runs before `readSessions` +
   the live-session guard (local cookie parse). Reorder to
   `getUser → sessions guard → listAuthMethods` and the crafted-POST/suppressed
   path costs one provider call instead of two. Five-line change, no behavior
   difference on the happy path.
2. **Observability — no dedicated audit event for discover outcomes.** Only the
   inner challenge-failure audit fires; success and the opaque-400 reasons are
   invisible in logs. Fine for staging; add an `auth_event` (+ ideally the env
   kill-switch from the spec notes) before the production flip.

### LOW

3. `use-conditional-passkey.ts` (342 lines): dual-mode + staged dispatch + retry
   matrix is inherently stateful (5 refs, 2 fetchers). Well-commented and
   latch-guarded; spec decision §1 chose the single hook deliberately. Rule of
   thumb going forward: the next mode/feature added here should trigger a split.
4. `DiscoverResponse` duplicated in the hook rather than imported from the route
   module — deliberate (keeps server-only imports out of the client graph) and
   documented inline. Acceptable; a shared types-only module would also work.
5. `decodeUserHandle`: `Buffer.from(x, 'base64url')` decodes leniently, so
   malformed input can pass garbage to `getUser`. Harmless (opaque 400 either
   way) but a strict charset check would be tidier.
6. `identity-challenge.ts` uses `Buffer` — server-safe today (loader-only
   import) but breaks if ever imported client-side. Worth a comment or a
   web-safe base64url encoding.
7. Test gap: `beginDiscovery` single-flight (re-click while 'submitting'
   returns false) has no spec.
8. Rate-limit budget: one discovery login consumes 2 of the shared 10/5-min
   webauthn budget (documented in rate-limit.ts). Fine by design — watch 429
   rates at launch.

## Validation Results (identical tree, this session)

| Check | Result |
|---|---|
| Type check (app + cypress) | Pass |
| ESLint / Prettier / i18n (lefthook gate) | Pass |
| Component suite | Pass — 739/739 |
| E2E (cold fake server): passkey journeys, core-signin, hydrated-submit, verify-otp | Pass — 22/22 |
| Manual staging (real Zitadel): quiet load, button picker, cancel copy | Pass |

## Files Reviewed

All 54 changed files (28 source via feat commit, 25 specs via test commit,
en.po regenerated). Key modules read in full: passkey-discover.tsx,
identity-challenge.ts, use-conditional-passkey.ts, webauthn.service.ts,
login/index.tsx, passkey-hint.ts, rate-limit.ts, harness/scenario support.
