import type { Decision } from './login-decision';
import type { AuthRequest } from '@/providers/types';

const ORG_SCOPE = /urn:zitadel:iam:org:id:([0-9]+)/;

export function deriveOrganizationFromScopes(scopes: string[]): string | undefined {
  for (const s of scopes) {
    const m = ORG_SCOPE.exec(s);
    if (m) return m[1];
  }
  return undefined;
}

export interface AuthorizeInput {
  authRequest: AuthRequest;
  hasSessions: boolean;
  validSessionId?: string;
}

// target 'callback' means: call createCallback(validSessionId); 'error' carries .error.
export function decideAuthorize({
  authRequest,
  hasSessions,
  validSessionId,
}: AuthorizeInput): Decision {
  const org = deriveOrganizationFromScopes(authRequest.scopes);
  const baseParams = org ? { organization: org } : undefined;

  if (authRequest.prompt.includes('create')) return { target: '/signup', params: baseParams };
  if (authRequest.prompt.includes('select_account'))
    return { target: '/accounts', params: baseParams };

  if (authRequest.prompt.includes('login')) {
    const params: Record<string, string> = { ...(baseParams ?? {}) };
    if (authRequest.loginHint) {
      params.loginName = authRequest.loginHint;
      params.submit = 'true';
    }
    return { target: '/login', params };
  }

  if (authRequest.prompt.includes('none')) {
    return validSessionId
      ? { target: 'callback', params: { sessionId: validSessionId } }
      : { target: 'error', error: 'NO_ACTIVE_SESSION' };
  }

  // default: reuse a valid session if present, else go collect an identifier
  if (hasSessions && validSessionId)
    return { target: 'callback', params: { sessionId: validSessionId } };
  return { target: '/login', params: baseParams };
}
