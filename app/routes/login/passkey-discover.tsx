// app/routes/login/passkey-discover.tsx
//
// Resource route (action only): the identity-resolution step of the usernameless
// discovery path (spec: 2026-07-31-usernameless-passkey-discovery-design.md).
// The posted assertion is an UNTRUSTED identity claim — its signature is never
// checked; only response.userHandle (== Zitadel userId, probe-verified) is read.
// Every user-dependent failure collapses into ONE opaque 400 so this endpoint
// leaks exactly what the identifier form leaks (enumeration parity). The
// authenticating ceremony is the SECOND assertion, verified by Zitadel through
// the unchanged /login/passkey action.
// RESPONSE SHAPE: plain Response.json (NOT data()) — the client calls this action
// with a direct fetch(), not an RR fetcher, so the body must be raw JSON rather
// than the single-fetch envelope. See useConditionalPasskey.submitDiscover for why
// (fetcher lazy route discovery reloads the page mid-ceremony when the client
// module load hiccups; a pure JSON API hop needs none of that machinery).
import { readSessions, listSessions } from '@/modules/auth/session/cookie';
import { armUserBoundChallenge } from '@/resources/webauthn/webauthn.service';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { type ActionFunctionArgs } from 'react-router';
import { z } from 'zod';

const discoverSchema = z.object({ credential: z.string().min(1) });

export interface PasskeyDiscoverData {
  loginName: string;
  csrfToken: string;
  publicKeyCredentialRequestOptions: unknown;
}

export type PasskeyDiscoverError = { error: 'INVALID_INPUT' | 'DISCOVERY_FAILED' };

// Sanity bounds only — a userHandle is at most 64 bytes by WebAuthn spec; the
// base64url of that is under 128 chars. Anything outside is a shape violation.
const MAX_USER_HANDLE_B64 = 128;
const MAX_USER_HANDLE_BYTES = 64;

/** Read the assertion's userHandle (base64url → utf8 Zitadel userId). Null on any shape violation. */
function decodeUserHandle(credentialJson: string): string | null {
  try {
    const cred = JSON.parse(credentialJson) as { response?: { userHandle?: unknown } };
    const raw = cred.response?.userHandle;
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_USER_HANDLE_B64) {
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

  const parsed = discoverSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return Response.json({ error: 'INVALID_INPUT' }, { status: 400 });

  // ONE opaque failure for everything user-dependent — "no such user", "no passkey
  // method", "mint failed" and shape violations must be indistinguishable.
  const opaque = () => Response.json({ error: 'DISCOVERY_FAILED' }, { status: 400 });

  const userHandle = decodeUserHandle(parsed.data.credential);
  if (!userHandle) return opaque(); // non-resident key / malformed — client treats as non-event

  const user = await provider.getUser(userHandle);
  if (!user) return opaque();
  if (!(await provider.listAuthMethods(user.id)).includes('passkey')) return opaque();

  const sessions = await readSessions(request);
  // armUserBoundChallenge caller contract + crafted-POST guard: the loader suppresses
  // discovery whenever a live session exists, so a live entry here means the POST
  // bypassed the page. Refuse rather than let the arm supersede a LIVE cookie entry.
  const hasLiveSession = listSessions(sessions, Date.now()).some(
    (s) => s.loginName.toLowerCase() === user.loginName.toLowerCase()
  );
  if (hasLiveSession) return opaque();

  let armed;
  try {
    armed = await armUserBoundChallenge(
      provider,
      request,
      sessions,
      user,
      new URL(request.url).hostname
    );
  } catch {
    return opaque(); // deactivated user / provider hiccup — enumeration parity
  }
  if (!armed) return opaque();

  const [csrfToken, csrfSetCookie] = await getCsrfToken(request);
  const headers = new Headers();
  for (const cookie of armed.setCookies) headers.append('set-cookie', cookie);
  if (csrfSetCookie) headers.append('set-cookie', csrfSetCookie);
  // Deliberately NO passkey-hint write: the hint means "last successfully
  // AUTHENTICATED user", and the /login/passkey verify action writes it on
  // success — discovery only identifies (spec, design decisions).
  const payload: PasskeyDiscoverData = {
    loginName: armed.loginName,
    csrfToken,
    publicKeyCredentialRequestOptions: armed.publicKeyCredentialRequestOptions,
  };
  return Response.json(payload, { headers });
}
