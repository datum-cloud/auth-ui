# Pull Request Guidelines

## Title

Write a clear, descriptive title that summarizes your changes. For example:

- "Fix login redirect loop in authentication flow"
- "Add Microsoft Entra ID to the provider seam"
- "Update React Router and related dependencies"

## Description

Briefly describe what this PR changes and why. Focus on:

- What problem is being solved or what feature is being added
- The impact of the change
- The related issue number, if applicable (e.g., "Fixes #123" or "Closes #456")

## Labels

Please add the appropriate label(s) to your PR:

- `bug` — fixing a bug or a broken behavior
- `enhancement` — new feature or improvement
- `documentation` — documentation-only changes
- `invalid` — the PR is incorrect or unnecessary (typically when closing it)

## Changelog

`CHANGELOG.md` is maintained by hand and follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). If this change is
user-facing, add an entry under `## [Unreleased]` in the same PR.

## Checklist

- [ ] `bun run typecheck` passes
- [ ] `bun run lint:ci` passes (the `no-console` rule allows only `console.error`
      and `console.warn` in shipped `app/` source)
- [ ] `bun run test:unit` passes (Cypress component tests)
- [ ] **Public URLs unchanged** — route, redirect, and callback URLs are a frozen
      contract (`app/routes/paths.ts`); changing one is a breaking change and needs
      explicit sign-off
- [ ] **No raw PII in logs** — login names / emails go through `hashActor`; no
      secrets, tokens, or cookies logged
- [ ] Architectural boundaries hold — `bun run lint:boundaries` passes (provider
      seam, `shared` is a leaf, no cycles; see `.dependency-cruiser.cjs`)

## Screenshots

<!-- For UI changes, include before/after screenshots. Delete this section otherwise. -->
