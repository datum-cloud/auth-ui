import { paths } from '@/routes/paths';

/**
 * The login-bounce target used by ceremony guards that need to send the user back
 * to /login when loginName/session is missing. Reproduces the verbatim
 * `requestId ? { requestId, organization } : undefined` gate: organization is ONLY
 * threaded alongside an active requestId, so a stray organization never leaks into
 * the bare /login URL.
 */
export function redirectToLogin(requestId?: string, organization?: string): string {
  return paths.login.index(requestId ? { requestId, organization } : undefined);
}
