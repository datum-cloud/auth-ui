// /reauth/:provider/callback — headless loader completing an idp-reauth round-trip.
// Verifies the returned idpIntent onto the EXISTING session via performReauth; never
// creates a session or signs in as a different identity (that's the ordinary /sso
// callback's job, a deliberately separate code path — see the design doc).
//
// No app-level state/nonce binds this GET to the request that started the round-trip
// (reviewed and deliberately kept this way, not an oversight): the idpIntentId/idpIntentToken
// pair is minted and validated by ZITADEL itself, opaque and unforgeable without actually
// completing a real OAuth round-trip with the provider — an attacker cannot manufacture a
// valid pair out-of-band the way they could forge our own state param. The actual security
// boundary is performReauth's identity check (FAILED_PRECONDITION → 'access-denied' when the
// intent was verified against a DIFFERENT user than the active session), which a same-origin
// app-level nonce would not add to. /sso/:provider/callback (processIdpCallback) relies on the
// identical Zitadel-token + identity-check pairing with no state param either — this matches
// that established, deliberate pattern rather than diverging from it.
import { readSessions, mostRecent, serializeSessions } from '@/modules/auth/session/cookie';
import { performReauth } from '@/resources/reauth/reauth.service';
import { validateReturnTo } from '@/resources/shared/return-to';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { env } from '@/server/infra/env.server';
import { redirect, type LoaderFunctionArgs } from 'react-router';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const idpIntentId = url.searchParams.get('id');
  const idpIntentToken = url.searchParams.get('token');
  const rawReturnTo = url.searchParams.get('returnTo');
  // Degraded fallback for the two error-redirect paths below (context-missing /
  // access-denied) — just carrying a best-effort value forward for a retry, always safe
  // since /reauth re-validates it. The SUCCESS path passes rawReturnTo (not this) to
  // performReauth so its own default-resolution logic runs when this doesn't validate,
  // instead of prematurely collapsing to /passkeys before performReauth ever sees it.
  const returnTo = validateReturnTo(rawReturnTo) ?? paths.passkeys();
  const providerSlug = params.provider ?? 'idp';

  const provider = providerForRequest(request);
  const sessions = await readSessions(request);
  if (!mostRecent(sessions)) return redirect(paths.login.index());

  if (!idpIntentId || !idpIntentToken) {
    return redirect(paths.reauthIdp.error(providerSlug, { returnTo, reason: 'context-missing' }));
  }

  const result = await performReauth(provider, sessions, {
    factor: 'idp',
    idpIntentId,
    idpIntentToken,
    returnTo: rawReturnTo,
    consoleUrl: `${env.ZITADEL_API_URL}/ui/console`,
    defaultAppUrl: env.DEFAULT_APP_URL,
  });
  if (!result.ok) {
    // The only failure performReauth's idp branch returns (rather than throws) is an
    // idpIntent verified against a DIFFERENT user than the active session — same copy
    // and reason key as /sso's access-denied case.
    return redirect(paths.reauthIdp.error(providerSlug, { returnTo, reason: 'access-denied' }));
  }
  return redirect(result.target, {
    headers: { 'set-cookie': await serializeSessions(result.sessions) },
  });
}

export default function ReauthProviderCallback() {
  return null;
}
