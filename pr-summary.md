# Fix Sentry errors: RSC serialization, IDP intent re-render, and noise suppression

## Summary

This PR fixes three categories of production Sentry errors on the login UI:

1. **RSC serialization failure on `/accounts` and `/logout`** — Protobuf `Session` objects passed as props to client components
2. **IDP intent "failed_precondition" on `/idp/[provider]/success`** — Re-render after server action re-fetches a consumed intent
3. **Noisy framework-level errors** — Suppressed via Sentry `ignoreErrors`

## Changes

### 1. Fix protobuf Session serialization across RSC boundary

**Error:** `Only plain objects, and a few built-ins, can be passed to Client Components from Server Components. Classes or null prototypes are not supported.`

**Root cause:** The `/accounts` and `/logout` server components fetch `Session[]` protobuf objects (which contain `bigint` timestamps and null-prototype internal fields) and pass them directly as props to `"use client"` components. React Server Components cannot serialize these across the boundary.

**Fix:**

- **`apps/login/src/lib/serialize.ts`** (new) — `toPlainObject()` helper that deep-clones via `JSON.parse(JSON.stringify())` with BigInt-to-Number conversion, stripping null prototypes and non-serializable fields
- **`apps/login/src/app/(main)/(boxed)/accounts/page.tsx`** — Wrap `loadSessions()` result with `toPlainObject()` before passing to `<SessionsList>`
- **`apps/login/src/app/(main)/(boxed)/logout/page.tsx`** — Same fix for `<SessionsClearList>`
- **`apps/login/src/lib/server/session.ts`** — Refactored `continueWithSession` to accept `{ sessionId, loginName, organizationId, requestId }` instead of the full `Session` protobuf object, avoiding serialization issues on the client-to-server-action boundary
- **`apps/login/src/components/session-item.tsx`** — Updated `continueWithSession` call site to pass only the needed fields

### 2. Handle consumed IDP intent on re-render

**Error:** `ConnectError: [failed_precondition] Intent has not succeeded`

**Root cause:** After the IDP success page renders and the `<IdpSignin>` client component calls the `createNewSessionFromIdpIntent` server action (which consumes the intent), Next.js re-renders the server component as part of the action response. This re-render calls `retrieveIDPIntent` again with the same `id`/`token`, but the intent has already been consumed.

**Fix:**

- **`apps/login/src/app/(main)/(boxed)/idp/[provider]/success/page.tsx`** — Wrapped `retrieveIDPIntent` in a try-catch. If the error is `FAILED_PRECONDITION` (code 9), it returns a benign message via `loginFailed()` instead of throwing. Other errors are re-thrown.

### 3. Suppress framework-level Sentry noise

**Errors:**

- `The router state header was sent but could not be parsed` — Malformed RSC requests from bots/crawlers sending invalid `Next-Router-State-Tree` headers
- `transformAlgorithm is not a function` — Node.js 20.x `TransformStream` race condition during RSC streaming (client disconnect mid-stream)

**Fix:**

- **`apps/login/sentry.server.config.ts`** — Added both patterns to `ignoreErrors`
