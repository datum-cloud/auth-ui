// cypress/component/modules/auth/session/session-cookie-path.cy.ts
//
// The `sessions` cookie was scoped to Path=/ while every sibling cookie is /id, so the session
// handles rode along on every request to the whole host. It is now /id-scoped, and for one release
// every response that sets it also expires the old Path=/ cookie so the two never coexist.
// Node-bound: cookie.ts is stubbed out of the component browser bundle.
import { callService } from '../../../../support/node/call-service';

describe('sessions cookie scope', () => {
  it('serializeSessions writes Path=/id, and the migration clear targets Path=/', () => {
    callService({ fn: 'hardeningCheck', hardeningOp: 'sessionsCookieScoped' }).then((v) => {
      expect(v.outcome.written).to.match(/^sessions=/);
      expect(v.outcome.written).to.match(/;\s*Path=\/id(;|$)/);
      expect(v.outcome.written).to.match(/HttpOnly/i);
      expect(v.outcome.legacyClear).to.match(/^sessions=; Path=\/; Max-Age=0/);
    });
  });
});

describe('legacyRootSessionsClearMiddleware (migration, remove after 2027-01-31)', () => {
  it('appends the Path=/ expiry when a response sets the sessions cookie, keeping the rest', () => {
    callService({ fn: 'hardeningCheck', hardeningOp: 'legacyClearMiddleware' }).then((v) => {
      const cookies = v.outcome.setsCookies as string[];
      expect(
        cookies.some((c) => /^sessions=[^;]+;.*Path=\/id/.test(c)),
        'the new cookie'
      ).to.equal(true);
      expect(cookies.some((c) => c.startsWith('sessions=; Path=/; Max-Age=0'))).to.equal(true);
      expect(
        cookies.some((c) => c.startsWith('csrf=')),
        'other cookies survive'
      ).to.equal(true);
      expect(v.outcome.setsBody).to.equal('ok');
    });
  });

  it('leaves responses that do not set the sessions cookie alone', () => {
    callService({ fn: 'hardeningCheck', hardeningOp: 'legacyClearMiddleware' }).then((v) => {
      expect(v.outcome.otherCookies).to.deep.equal(['csrf=x; Path=/id']);
    });
  });

  it('is mounted in app/server.ts', () => {
    callService({ fn: 'hardeningCheck', hardeningOp: 'serverMountsLegacyClear' }).then((v) => {
      expect(v.outcome.mounted).to.equal(true);
    });
  });
});
