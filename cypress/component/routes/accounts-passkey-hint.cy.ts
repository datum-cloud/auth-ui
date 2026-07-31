// Switch = "this account is now the browser's active identity" → hint refresh.
// Dead-session switch (reauthRedirect) must NOT rewrite it.
import { callService } from '../../support/node/call-service';

const ALICE = 'alice@acme.test';

describe('/accounts switch — passkey-hint refresh', () => {
  it('a successful switch rewrites the hint to the switched-to account', () => {
    callService({
      fn: 'accountsAction',
      provider: 'singleton',
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u1', loginName: ALICE } }],
      request: {
        url: 'http://localhost/id/accounts',
        sessions: [{ id: 's1', token: 't1', loginName: ALICE }],
        form: { intent: 'switch', sessionId: 's1' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.passkeyHint).to.equal(ALICE);
    });
  });

  it('a dead-session switch (re-auth recovery) does NOT rewrite the hint', () => {
    callService({
      fn: 'accountsAction',
      provider: 'singleton',
      sessionResults: { s1: { mode: 'throw', code: 'NOT_FOUND' } },
      request: {
        url: 'http://localhost/id/accounts',
        sessions: [{ id: 's1', token: 't1', loginName: ALICE }],
        form: { intent: 'switch', sessionId: 's1' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(
        (v.response?.setCookies ?? []).some((c: string) => c.startsWith('passkey-hint='))
      ).to.equal(false);
    });
  });
});
