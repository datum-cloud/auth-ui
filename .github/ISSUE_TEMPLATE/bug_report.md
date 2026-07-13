---
name: Bug report
about: Report a defect in auth-ui (a reproducible, non-security problem)
title: ""
labels: bug
assignees: ""
---

## Summary

A clear, one- or two-sentence description of the bug.

## Steps to reproduce

1. Go to '...'
2. Sign in with provider '...'
3. Click '...'
4. See the error

## Expected vs actual

**Expected:** what you expected to happen.

**Actual:** what actually happened.

## Environment

- auth-ui image / commit sha: <!-- e.g. ghcr.io/datum-cloud/auth-ui:<sha>, or the sha shown in the footer -->
- Browser & version: <!-- e.g. Chrome 126, Safari 17.5, Firefox 127 -->
- Auth provider: <!-- `fake` (local dev) or `zitadel` -->
- Deployment: <!-- local dev / staging / production -->

## Logs

Paste any relevant console output, network responses, or server logs.

> **Redact secrets and personal data** before pasting — strip tokens, cookies,
> `Authorization` headers, email addresses, and login names.

```text
(paste redacted logs here)
```

## Security note

> If this is a **security vulnerability**, do **not** file it here. Report it
> privately via [SECURITY.md](../../SECURITY.md) →
> [Report a vulnerability](https://github.com/datum-cloud/auth-ui/security/advisories/new).
