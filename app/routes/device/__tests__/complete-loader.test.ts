// @vitest-environment node
//
// device/complete — terminal completion screen loader.
//
// This route is the post-decision landing the /device/authorize action redirects to. It must
// validate ?decision (enum authorize|deny) and return it, WITHOUT ever calling the provider /
// getDeviceAuth — the device-auth request was legitimately consumed by authorizeDevice, so any
// re-resolution would NOT_FOUND and surface a false "Code expired". A missing/tampered ?decision
// fails safe to 'deny'.
import { loader } from '@/routes/device/complete';
import { describe, it, expect } from 'vitest';

const ORIGIN = 'http://localhost';

async function runLoader(req: Request) {
  return loader({ request: req, params: {}, context: {} as never } as never);
}

function dataOf(res: unknown): Record<string, unknown> | null {
  return (res as { data?: Record<string, unknown> }).data ?? null;
}

describe('device/complete loader — decision validation', () => {
  it('?decision=authorize → returns decision: authorize', async () => {
    const res = await runLoader(new Request(`${ORIGIN}/id/device/complete?decision=authorize`));
    expect(dataOf(res)?.decision).toBe('authorize');
  });

  it('?decision=deny → returns decision: deny', async () => {
    const res = await runLoader(new Request(`${ORIGIN}/id/device/complete?decision=deny`));
    expect(dataOf(res)?.decision).toBe('deny');
  });

  it('missing ?decision → fails safe to deny', async () => {
    const res = await runLoader(new Request(`${ORIGIN}/id/device/complete`));
    expect(dataOf(res)?.decision).toBe('deny');
  });

  it('tampered ?decision → fails safe to deny', async () => {
    const res = await runLoader(new Request(`${ORIGIN}/id/device/complete?decision=garbage`));
    expect(dataOf(res)?.decision).toBe('deny');
  });
});
