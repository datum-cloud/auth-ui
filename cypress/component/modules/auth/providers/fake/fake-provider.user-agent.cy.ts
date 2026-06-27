// cypress/component/modules/auth/providers/fake/fake-provider.user-agent.cy.ts
//
// Component (no-mount) port of
// app/modules/auth/providers/fake/__tests__/fake-provider.user-agent.test.ts.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';

describe('FakeAuthProvider — userAgent forwarding', () => {
  it('records userAgent on lastCreateSessionOpts when passed', async () => {
    const p = new FakeAuthProvider();
    const ua = {
      fingerprintId: 'fp-abc',
      ip: '1.2.3.4',
      description: 'Chrome 124 · Blink 537.36 · macOS 10.15',
      header: { 'user-agent': { values: ['Mozilla/5.0'] } },
    };

    await p.createSession({}, { userAgent: ua });

    expect(p.lastCreateSessionOpts?.userAgent).to.deep.equal(ua);
  });

  it('leaves userAgent undefined on lastCreateSessionOpts when not passed', async () => {
    const p = new FakeAuthProvider();

    await p.createSession({});

    expect(p.lastCreateSessionOpts?.userAgent).to.be.undefined;
  });

  it('accepts a partial userAgent with only fingerprintId', async () => {
    const p = new FakeAuthProvider();
    const ua = { fingerprintId: 'fp-only' };

    await p.createSession({}, { userAgent: ua });

    expect(p.lastCreateSessionOpts?.userAgent).to.deep.equal({ fingerprintId: 'fp-only' });
  });
});
