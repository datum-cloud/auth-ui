# PR Summary

## Overview

This PR introduces a "last used" badge for identity provider (IDP) login buttons, improves the registration/waitlist UI copy, and adds i18n support across all locale files.

---

## Features

### 1. Last Used Badge on IDP Buttons

- **What**: A "Last used" badge appears on the identity provider (Google, Apple, GitHub, etc.) that the user last successfully signed in with.
- **Storage**: The last-used IDP ID is stored in an HTTP-only cookie (`last-used-idp-id`) with a 1-year expiry.
- **When it's set**: The cookie is **only** set when authentication completes successfully—not when the user merely clicks an IDP button.
- **Where it appears**: The badge is shown on IDP buttons across:
  - Login name page
  - IDP selection page
  - Register page
  - Authenticator setup page
  - IDP link page

**Technical details:**
- Cookie helpers: `setLastUsedIdpId()` and `getLastUsedIdpId()` in `lib/cookies.ts`
- Cookie is set in:
  - `createNewSessionFromIdpIntent` (when returning redirect, including email verification and MFA flows)
  - `registerUserAndLinkToIDP` (when registration with IDP linking succeeds)
- `idpId` is passed through the success flow: success page → `loginSuccess`/`linkingSuccess` → `IdpSignin` → `createNewSessionFromIdpIntent`
- `BaseButton` shows the badge when `isLastUsed` is true; custom props are destructured to avoid passing them to the DOM

### 2. Registration / Waitlist UI Updates

- **Register page**: Uses the new `waitlist` namespace with `title`, `subtitle`, and `description` for clearer hierarchy.
- **Login button**: Removed the waitlist question/info block from the register page footer.
- **Layout**: Title in `h3`, subtitle in `h1`, description in `p` for improved visual hierarchy.

---

## Locale Updates

All locale files (de, es, it, pl, ru, zh) were updated to match `en.json`:

| Key | Description |
|-----|-------------|
| `loginname.register` | "Create account" (was "Register new user" etc.) |
| `waitlist.title` | "Welcome!" |
| `waitlist.subtitle` | "Let's get you started" |
| `waitlist.description` | "Create your free account with just a few details" |
| `register.alreadyRegistered` | "Already have an account?" |
| `register.loginNow` | "Log in here." |
| `idp.lastUsed` | "Last used" (for the IDP badge) |

---

## Files Changed

### Core Feature
- `apps/login/src/lib/cookies.ts` – Cookie helpers for last-used IDP
- `apps/login/src/components/idps/base-button.tsx` – Badge UI and prop handling
- `apps/login/src/components/sign-in-with-idp.tsx` – Pass `lastUsedIdpId` and `isLastUsed`
- `apps/login/src/components/idp-signin.tsx` – Pass `idpId` to session creation
- `apps/login/src/components/idps/pages/login-success.tsx` – Pass `idpId` to `IdpSignin`
- `apps/login/src/components/idps/pages/linking-success.tsx` – Pass `idpId` to `IdpSignin`
- `apps/login/src/lib/server/idp.ts` – Set cookie on success, pass `idpId` through flow
- `apps/login/src/lib/server/register.ts` – Set cookie on successful IDP registration
- `apps/login/src/app/(main)/(boxed)/idp/[provider]/success/page.tsx` – Pass `idpId` to success components

### Pages Using SignInWithIdp (pass `lastUsedIdpId`)
- `apps/login/src/app/(main)/(illustration)/loginname/page.tsx`
- `apps/login/src/app/(main)/(boxed)/idp/page.tsx`
- `apps/login/src/app/(main)/(illustration)/register/page.tsx`
- `apps/login/src/app/(main)/(boxed)/authenticator/set/page.tsx`
- `apps/login/src/app/(main)/(boxed)/idp/link/page.tsx`

### UI Updates
- `apps/login/src/app/(main)/(illustration)/register/page.tsx` – Waitlist title/subtitle/description
- `apps/login/src/app/(main)/(illustration)/register/_login-btn.tsx` – Removed waitlist block

### Locales
- `apps/login/locales/de.json`
- `apps/login/locales/en.json`
- `apps/login/locales/es.json`
- `apps/login/locales/it.json`
- `apps/login/locales/pl.json`
- `apps/login/locales/ru.json`
- `apps/login/locales/zh.json`

---

## Testing Notes

- Verify the "Last used" badge appears on the correct IDP after a successful sign-in.
- Verify the badge does **not** appear when the user clicks an IDP but does not complete auth (e.g. cancels or fails).
- Verify translations render correctly for de, es, it, pl, ru, zh.
- Verify the register page shows the new waitlist copy and layout.
