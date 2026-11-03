// cypress/component/resources/password/password-change-sudo.cy.ts
//
// NO-MOUNT: the step-up gate on the authenticated password change, mirroring
// cypress/component/resources/passkeys/passkeys.service.cy.ts. A live session alone used to be
// enough, so a 24h session cookie lifted from an unattended browser could rotate the password.
// A factor must now have been verified within the sudo window, else SUDO_REQUIRED → /reauth.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { changePassword, passwordChangeSudo } from '@/resources/password/password.service';
import { SUDO_TTL_MS } from '@/resources/shared/sudo';

const NEW_PASSWORD = 'N3w-Password!';

async function seeded() {
  const fake = new FakeAuthProvider({
    users: [{ id: 'u1', loginName: 'mia@acme.test' }],
    passwords: { u1: 'Password1!' },
    authMethods: { u1: ['password'] },
    // Real factor stamps: the sudo check compares against a real Date.now()-based nowMs.
    realFactorTimestamps: true,
  });
  const s = await fake.createSession({ password: 'Password1!' }, { userId: 'u1' });
  const session = { id: s.id, token: s.token };
  return { fake, session };
}

const form = (sessionId: string, extra: Record<string, string> = {}) => ({
  sessionId,
  password: NEW_PASSWORD,
  confirm: NEW_PASSWORD,
  ...extra,
});

describe('changePassword — step-up (sudo) gate', () => {
  it('fresh sudo ⇒ the password is changed and the user lands on /signed-in', async () => {
    const { fake, session } = await seeded();
    const spy = cy.spy(fake, 'changePasswordWithSession');
    const r = await changePassword(
      fake,
      form(session.id),
      (id) => (id === session.id ? session : undefined),
      undefined,
      Date.now()
    );
    expect(r).to.deep.equal({ ok: true, target: '/signed-in' });
    expect(spy.callCount).to.equal(1);
  });

  it('stale sudo ⇒ SUDO_REQUIRED with a /reauth round-trip, and the provider is never called', async () => {
    const { fake, session } = await seeded();
    const spy = cy.spy(fake, 'changePasswordWithSession');
    const r = await changePassword(
      fake,
      form(session.id),
      (id) => (id === session.id ? session : undefined),
      undefined,
      Date.now() + SUDO_TTL_MS + 1
    );
    expect(r).to.deep.equal({
      ok: false,
      error: 'SUDO_REQUIRED',
      reauthTarget: '/reauth?returnTo=%2Fpassword%2Fchange',
    });
    expect(spy.callCount, 'no password rotation on a stale session').to.equal(0);
  });

  it('stale sudo mid-ceremony keeps the requestId in the returnTo', async () => {
    const { fake, session } = await seeded();
    const r = await changePassword(
      fake,
      form(session.id, { requestId: 'oidc_abc' }),
      (id) => (id === session.id ? session : undefined),
      undefined,
      Date.now() + SUDO_TTL_MS + 1
    );
    expect(r.ok).to.equal(false);
    if (!r.ok && r.error === 'SUDO_REQUIRED') {
      expect(r.reauthTarget).to.equal(
        `/reauth?returnTo=${encodeURIComponent('/password/change?requestId=oidc_abc')}`
      );
    }
  });

  it('a session the provider no longer knows ⇒ SESSION_EXPIRED, not a crash', async () => {
    const { fake, session } = await seeded();
    fake.setSessionResult(session.id, { mode: 'throw', code: 'PERMISSION_DENIED' });
    const r = await changePassword(
      fake,
      form(session.id),
      (id) => (id === session.id ? session : undefined),
      undefined,
      Date.now()
    );
    expect(r).to.deep.equal({ ok: false, error: 'SESSION_EXPIRED' });
  });

  it('passwordChangeSudo (the loader UX check) reports fresh, then stale past the window', async () => {
    const { fake, session } = await seeded();
    expect(await passwordChangeSudo(fake, session, Date.now())).to.equal('fresh');
    expect(await passwordChangeSudo(fake, session, Date.now() + SUDO_TTL_MS + 1)).to.equal('stale');
  });
});
