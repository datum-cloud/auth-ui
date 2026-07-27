// /reauth/:provider/callback — headless loader completing an idp-reauth round-trip.
// Verifies the returned idpIntent onto the EXISTING session via performReauth; never
// creates a session or signs in as a different identity (that's the ordinary /sso
// callback's job, a deliberately separate code path — see the design doc).
import { readSessions, mostRecent, serializeSessions } from '@/modules/auth/session/cookie';
import { performReauth } from '@/resources/reauth/reauth.service';
import { validateReturnTo } from '@/resources/shared/return-to';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { redirect, type LoaderFunctionArgs } from 'react-router';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const idpIntentId = url.searchParams.get('id');
  const idpIntentToken = url.searchParams.get('token');
  const returnTo = validateReturnTo(url.searchParams.get('returnTo')) ?? paths.passkeys();
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
    returnTo,
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
