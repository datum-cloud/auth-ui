// app/resources/signup/complete-handoff.ts
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { serializeLastUsedLogin } from '@/modules/auth/session/last-used-login';
import { serializePasskeyHint } from '@/modules/auth/session/passkey-hint';
import { completeEmailLinkSignup } from '@/resources/signup';
import { getOrCreateFingerprintId, userAgentFromRequest } from '@/server/user-agent';
import { redirect } from 'react-router';

export interface CompleteSignupHandoffInput {
  userId: string;
  code: string;
  loginName: string;
  organization?: string;
  requestId?: string;
  deviceTrackingToken?: string;
  next?: 'passkey';
}

/**
 * Verify the address and hand off to passkey setup — the single ending for signup, reached both
 * by clicking the emailed link and by typing the emailed code.
 *
 * Throws whatever completeEmailLinkSignup throws (a spent or wrong code surfaces as a
 * ProviderError); callers map that to their own error state.
 */
export async function completeSignupHandoff(
  provider: AuthProvider,
  request: Request,
  input: CompleteSignupHandoffInput
): Promise<Response> {
  const sessions = await readSessions(request);
  // Brand-new users arrive without a fingerprint cookie; mint one so the session carries a
  // browser identity. Not deviceTrackingToken, which is a MaxMind fraud signal.
  const [fingerprintId, fpCookie] = getOrCreateFingerprintId(request);

  const result = await completeEmailLinkSignup(provider, sessions, {
    userId: input.userId,
    code: input.code,
    loginName: input.loginName,
    organization: input.organization,
    requestId: input.requestId,
    next: input.next,
    deviceTrackingToken: input.deviceTrackingToken,
    userAgent: userAgentFromRequest(request, fingerprintId),
  });

  const headers = new Headers();
  headers.append('set-cookie', await serializeSessions(result.sessions));
  headers.append('set-cookie', await serializeLastUsedLogin('email'));
  headers.append('set-cookie', await serializePasskeyHint(input.loginName));
  if (fpCookie) headers.append('set-cookie', fpCookie);
  return redirect(result.target, { headers });
}
