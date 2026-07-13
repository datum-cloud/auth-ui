<!--
Thanks for contributing to datum-cloud/auth-ui.
Fill in each section. Keep the PR focused — one logical change per PR.
-->

## Summary

What does this PR change, and why? Describe the behavior before and after.

## Linked issue

<!-- e.g. Closes #123 / Refs #456 -->

## Type

- [ ] feat — new user-facing capability
- [ ] fix — bug fix
- [ ] refactor — behavior-preserving restructure
- [ ] chore — tooling, deps, or housekeeping
- [ ] docs — documentation only
- [ ] test — tests only
- [ ] perf — performance improvement

## Checklist

- [ ] `bun run typecheck` passes
- [ ] `bun run lint:ci` passes (no new `console.*` — guarded by the `no-console` rule)
- [ ] `bun run test:unit` passes
- [ ] **URLs are byte-frozen** — no route, redirect, or callback URL changed
      without going through the URL-resolution gate
- [ ] **No raw PII in logs** — login names / emails are hashed (`hashActor`) or
      redacted; no secrets, tokens, or cookies logged
- [ ] `CHANGELOG.md` `[Unreleased]` updated (if this change is user-facing)
- [ ] Boundary layers respected (`routes` → `resources` → `modules` →
      `providers`); `bun run lint:boundaries` passes if layers were touched

## Screenshots

<!-- For UI changes, include before/after screenshots. Delete this section otherwise. -->
