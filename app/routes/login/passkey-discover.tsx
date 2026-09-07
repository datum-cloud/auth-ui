// app/routes/login/passkey-discover.tsx
//
// Resource route (action only): the identity-resolution step of the usernameless
// discovery path.
// The posted assertion is an UNTRUSTED identity claim — its signature is never
// checked; only response.userHandle (the Zitadel user ID) is read.
// Every user-dependent failure collapses into ONE opaque 400 so this endpoint
// leaks exactly what the identifier form leaks (enumeration parity) — the AUDIT
// event carries the real reason instead. The authenticating ceremony is the
// SECOND assertion, verified by Zitadel through the unchanged /login/passkey
// action.
// RESPONSE SHAPE: plain Response.json (NOT data()) — the client calls this action
// with a direct fetch(), not an RR fetcher, so the body must be raw JSON rather
// than the single-fetch envelope. See useConditionalPasskey.submitDiscover for why
// (fetcher lazy route discovery reloads the page mid-ceremony when the client
// module load hiccups; a pure JSON API hop needs none of that machinery).
import { readSessions, listSessions } from '@/modules/auth/session/cookie';
import type { PasskeyDiscoverData } from '@/resources/webauthn/passkey-discover.types';
import { armUserBoundChallenge } from '@/resources/webauthn/webauthn.service';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { env } from '@/server/infra/env.server';
import { logAuthEvent, hashActor } from '@/server/observability';
import { type ActionFunctionArgs } from 'react-router';
import { z } from 'zod';

// `organization` is optional: a bare sign-in sends none and the entry is correctly org-less.
const discoverSchema = z.object({
  credential: z.string().min(1),
  organization: z.string().optional(),
});

// Sanity bounds only — a userHandle is at most 64 bytes by WebAuthn spec; the
// base64url of that is under 128 chars. Anything outside is a shape violation.
const MAX_USER_HANDLE_B64 = 128;
const MAX_USER_HANDLE_BYTES = 64;
// Strict base64url alphabet — Buffer decodes leniently (silently drops invalid
// chars), so gate the charset ourselves rather than pass garbage to getUser.
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** Read the assertion's userHandle (base64url → utf8 Zitadel userId). Null on any shape violation. */
function decodeUserHandle(credentialJson: string): string | null {
  try {
    const cred = JSON.parse(credentialJson) as { response?: { userHandle?: unknown } };
    const raw = cred.response?.userHandle;
    if (
      typeof raw !== 'string' ||
      raw.length === 0 ||
      raw.length > MAX_USER_HANDLE_B64 ||
      !BASE64URL_RE.test(raw)
    ) {
      return null;
    }
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    return decoded.length > 0 && decoded.length <= MAX_USER_HANDLE_BYTES ? decoded : null;
  } catch {
    return null;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  // ONE opaque failure for everything user-dependent — "no such user", "no passkey
  // method", "mint failed" and shape violations must be indistinguishable to the
  // CALLER. The audit event carries the real reason for operators.
  const opaque = (reason: string) => {
    logAuthEvent('passkey_discover', 'failure', { reason });
    return Response.json({ error: 'DISCOVERY_FAILED' }, { status: 400 });
  };

  // Operational kill switch (env, default ON) — same opaque shape as every other
  // failure so flipping it mid-incident does not create a new observable state.
  if (!env.AUTH_PASSKEY_DISCOVERY_ENABLED) return opaque('disabled');

  const parsed = discoverSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    logAuthEvent('passkey_discover', 'failure', { reason: 'invalid_input' });
    return Response.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const userHandle = decodeUserHandle(parsed.data.credential);
  if (!userHandle) return opaque('no_user_handle'); // non-resident key / malformed

  const user = await provider.getUser(userHandle);
  if (!user) return opaque('unresolved_user');

  // Per-user guard. This endpoint decides what is ALLOWED independently of what the
  // /login loader chose to OFFER, so it stays correct against a crafted POST — and the
  // loader now arms discovery while a session is live, so a live entry here is ordinary
  // rather than evidence the page was bypassed.
  //
  // armUserBoundChallenge's caller contract forbids superseding a LIVE cookie entry, so
  // this case cannot proceed. It is NOT a failure though: the user tapped the passkey of
  // an account they already hold, so say so and let the client route there. Not an
  // enumeration leak — reaching this branch requires passing assertCsrf AND holding a
  // live signed sessions cookie for this exact user, which reveals nothing /accounts
  // does not already show. (The assertion signature is never verified here, so a forged
  // userHandle is assumed; the guard keys on THIS browser's sessions, which a forger
  // cannot influence.)
  const sessions = await readSessions(request);
  const hasLiveSession = listSessions(sessions, Date.now()).some(
    (s) => s.loginName.toLowerCase() === user.loginName.toLowerCase()
  );
  if (hasLiveSession) {
    logAuthEvent('passkey_discover', 'failure', { reason: 'already_signed_in' });
    return Response.json(
      { error: 'ALREADY_SIGNED_IN', loginName: user.loginName },
      { status: 409 }
    );
  }

  if (!(await provider.listAuthMethods(user.id)).includes('passkey')) {
    return opaque('no_passkey_method');
  }

  let armed;
  try {
    armed = await armUserBoundChallenge(
      provider,
      request,
      sessions,
      user,
      new URL(request.url).hostname,
      parsed.data.organization
    );
  } catch {
    return opaque('mint_failed'); // deactivated user / provider hiccup
  }
  if (!armed) return opaque('challenge_failed');

  logAuthEvent('passkey_discover', 'success', { actor: hashActor(user.loginName) });

  const [csrfToken, csrfSetCookie] = await getCsrfToken(request);
  const headers = new Headers();
  for (const cookie of armed.setCookies) headers.append('set-cookie', cookie);
  if (csrfSetCookie) headers.append('set-cookie', csrfSetCookie);
  // Deliberately NO passkey-hint write: the hint means "last successfully
  // AUTHENTICATED user", and the /login/passkey verify action writes it on
  // success — discovery only identifies.
  const payload: PasskeyDiscoverData = {
    loginName: armed.loginName,
    csrfToken,
    publicKeyCredentialRequestOptions: armed.publicKeyCredentialRequestOptions,
  };
  return Response.json(payload, { headers });
}
