// Tests for sso.tsx action — CODE-MAJ-07.
//
// The loader's getSession call, the unlink action's removeIdpLink call, and the start action's
// startIdpIntent call were all unguarded. A ProviderError produced a raw 500 with no audit event.
//
// This file verifies:
//   • start intent: a ProviderError from startIdpIntent returns a handled response (302 or 502)
//     and emits a failure audit event (no 500).
//
// Harness shape: runSsoAction({ form, startIdpIntent, onAuthEvent })
// Uses a DI second-argument seam on the action, matching the callback route pattern.
//
// @vitest-environment node
import { action, type SsoActionDeps } from './sso';
import { ProviderError } from '@/providers/types';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost/id/sso';

interface RunSsoActionOpts extends SsoActionDeps {
  form: Record<string, string>;
}

async function runSsoAction({ form, startIdpIntent, onAuthEvent }: RunSsoActionOpts) {
  // Mint a real CSRF token+cookie pair
  const [token, cookie] = await getCsrfToken(new Request(BASE));
  const cookieValue = cookie!.split(';')[0];

  const body = new URLSearchParams({ csrf: token, ...form });
  const request = new Request(BASE, {
    method: 'POST',
    headers: {
      cookie: cookieValue,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  return action({ request, params: {}, context: {} as never } as never, {
    startIdpIntent,
    onAuthEvent,
  });
}

describe('sso action — provider error handling (CODE-MAJ-07)', () => {
  it('start: provider error returns a handled response and logs failure (no 500)', async () => {
    const events: Array<{ event: string; outcome: string }> = [];
    const res = await runSsoAction({
      form: { intent: 'start', provider: 'google' },
      startIdpIntent: () => Promise.reject(new ProviderError('UNAVAILABLE', 'down')),
      onAuthEvent: (e, o) => events.push({ event: e, outcome: o }),
    });
    expect([302, 502]).toContain((res as Response).status);
    expect(events.some((e) => e.outcome === 'failure')).toBe(true);
  });
});
