// cypress/component/modules/auth/providers/fake/fake-provider.user-agent.cy.ts
//
// Component (no-mount) port of
// app/modules/auth/providers/fake/__tests__/fake-provider.user-agent.test.ts.
//
// NOTE: this exercises a FAKE provider (test double / harness), not production security logic.
// One representative test covering the userAgent pass-through (full, partial, and omitted).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';

describe('FakeAuthProvider — userAgent forwarding', () => {
  it('records userAgent (full or partial) on lastCreateSessionOpts when passed, and leaves it undefined when omitted', async () => {
    const p = new FakeAuthProvider();
    const ua = {
      fingerprintId: 'fp-abc',
      ip: '1.2.3.4',
      description: 'Chrome 124 · Blink 537.36 · macOS 10.15',
      header: { 'user-agent': { values: ['Mozilla/5.0'] } },
    };
    await p.createSession({}, { userAgent: ua });
    expect(p.lastCreateSessionOpts?.userAgent).to.deep.equal(ua);

    const p2 = new FakeAuthProvider();
    await p2.createSession({});
    expect(p2.lastCreateSessionOpts?.userAgent).to.be.undefined;

    const p3 = new FakeAuthProvider();
    await p3.createSession({}, { userAgent: { fingerprintId: 'fp-only' } });
    expect(p3.lastCreateSessionOpts?.userAgent).to.deep.equal({ fingerprintId: 'fp-only' });
  });
});
