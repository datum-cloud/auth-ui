// admin capability — isInstanceAdmin (the one REST-over-fetch routing check; not gRPC).
import type { ZitadelCtx } from './context';
import { TIMEOUTS } from './timeouts';

export async function isInstanceAdmin(
  ctx: ZitadelCtx,
  session: { id: string; token: string }
): Promise<boolean> {
  try {
    const res = await fetch(`${ctx.opts.serviceUrl}/auth/v1/memberships/me/_search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: '{}',
      // Bound the admin check so a hung Zitadel cannot stall the
      // /signed-in loader. AbortError is swallowed by the existing catch → fail-open false.
      signal: AbortSignal.timeout(TIMEOUTS.ADMIN_CHECK_MS),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { result?: Array<{ iam?: boolean; roles?: string[] }> };
    return (data.result ?? []).some(
      (m) => m.iam === true || (m.roles ?? []).some((r) => r.startsWith('IAM_'))
    );
  } catch {
    return false;
  }
}
