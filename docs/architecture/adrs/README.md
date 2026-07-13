# Architecture Decision Records

An **ADR** records a decision that was expensive to reach and would be expensive to reverse — the context that forced it, the alternatives that were rejected, and the consequences we accepted. It is written once, when the decision is made, and then left alone: an ADR is a historical record, not living documentation. When a decision changes, write a new ADR and mark the old one **Superseded**.

## When to Write One

Write an ADR when a choice:

- constrains how future code must be written (a boundary, a seam, an invariant), or
- was chosen over a plausible alternative that a newcomer would reasonably reach for, or
- trades safety for convenience — or convenience for safety — in a way that needs justifying, or
- is security-relevant and must not be silently undone.

Do **not** write one for library bumps, refactors with no behavioural consequence, or anything a code comment already explains at the site that matters.

## Status Vocabulary

| Status         | Meaning                                                              |
| -------------- | -------------------------------------------------------------------- |
| **Proposed**   | Written, under review; not yet binding                               |
| **Accepted**   | In force — the code reflects it and new code must respect it         |
| **Deprecated** | No longer applies; nothing replaces it                               |
| **Superseded** | Replaced by a later ADR (link it: _Superseded by [00X](./00X-….md)_) |

## Naming Convention

`NNN-kebab-slug.md` — a zero-padded sequence number, never reused, plus a short slug. Numbers are allocated in order of acceptance and are never renumbered, even when an ADR is superseded.

## Records

| ADR                                           | Title                         | Status   | Date       |
| --------------------------------------------- | ----------------------------- | -------- | ---------- |
| [001](./001-provider-seam.md)                 | Provider seam                 | Accepted | 2026-06-14 |
| [002](./002-cypress-over-vitest.md)           | Cypress over Vitest           | Accepted | 2026-06-26 |
| [003](./003-legacy-ui-v2-redirects.md)        | Legacy `/ui/v2/*` redirects   | Accepted | 2026-06-18 |
| [004](./004-idp-linking-flags.md)             | IdP linking flags             | Accepted | 2026-07-01 |
| [005](./005-login-org-scoping.md)             | Login org scoping             | Accepted | 2026-07-01 |
| [006](./006-signup-provisioning-invariant.md) | Signup provisioning invariant | Accepted | 2026-07-02 |

## Template

Copy this into a new `NNN-kebab-slug.md`:

```markdown
# NNN. Title

- **Status:** Proposed | Accepted | Deprecated | Superseded
- **Date:** YYYY-MM-DD

## Context

The forces at play. What was true before this decision, and what broke or would have broken.

## Decision

What we do, stated in the present tense. Name the files that carry it.

## Rationale

Why this, and why now.

## Alternatives Considered

### Alternative name

- **Pros:** …
- **Cons:** …
- **Why rejected:** …

## Consequences

**Positive**

- …

**Negative**

- …

**Risks & Mitigations**

| Risk | Mitigation |
| ---- | ---------- |
| …    | …          |

## References

- Related ADRs, docs, or code paths.
```
