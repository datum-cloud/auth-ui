// cypress/component/resources/sso/sso-unlink-sudo.cy.ts
//
// The unlink branch of runSsoAction used to check only that the session was alive, so a 24h
// session cookie lifted from an unattended browser could detach the user's only IdP. It now
// requires fresh sudo, the same window and /reauth round-trip as /id/passkeys.
// Node-bound: the action reads the session cookie and env.ALLOW_IDP_UNLINK.
import { callService } from '../../../support/node/call-service';

describe('runSsoAction unlink — step-up (sudo) gate', () => {
  it('stale sudo ⇒ redirect to /reauth with returnTo=/sso, and the link is untouched', () => {
    callService({ fn: 'hardeningCheck', hardeningOp: 'ssoUnlinkStaleSudo' }).then((v) => {
      expect(v.outcome.kind).to.equal('redirect');
      expect(v.outcome.location).to.equal('/reauth?returnTo=%2Fsso');
      expect(v.outcome.linksLeft, 'nothing was unlinked').to.equal(1);
      expect(
        v.audit.some((e) => e.event === 'idp.unlink' && e.outcome === 'failure'),
        'the refusal is audited'
      ).to.equal(true);
    });
  });

  it('fresh sudo ⇒ the link is removed and the user returns to /sso', () => {
    callService({ fn: 'hardeningCheck', hardeningOp: 'ssoUnlinkFreshSudo' }).then((v) => {
      expect(v.outcome.kind).to.equal('redirect');
      expect(v.outcome.location).to.equal('/sso');
      expect(v.outcome.linksLeft).to.equal(0);
    });
  });
});
