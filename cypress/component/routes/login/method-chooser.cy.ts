// cypress/component/routes/login/method-chooser.cy.ts
//
// cy.task port of app/routes/login/__tests__/method-chooser.test.tsx.
// (A) /login action intent=email-link → 302 to /login/verify/email.
// (B) /login/method loader → methods array, branding, redirect guards.
import { callService } from '../../../support/node/call-service';

// The chooser loader is SESSION-GATED: it acts only for a loginName this browser already holds a
// LIVE ceremony session for. /login's identifier action plants exactly this entry on the same
// response that redirects here, so supplying it is what makes these scenarios legitimate arrivals
// rather than the drive-by GETs the gate exists to refuse.
const ALICE_SESSION = { id: 's1', token: 'tok-s1', loginName: 'alice@acme.test' };
const MIA_SESSION = { id: 's1', token: 'tok-s1', loginName: 'mia@acme.test' };

/** The sole-linked-IdP fixture: one enrolled method ('idp'), one active+linked provider. */
const SOLE_IDP_SEED = {
  users: [{ id: 'u1', loginName: 'mia@acme.test' }],
  authMethods: { u1: ['idp'] },
  idps: [{ id: 'idp-google', name: 'Google', type: 'GOOGLE' }],
  idpLinks: { u1: [{ idpId: 'idp-google', idpUserId: 'g-1' }] },
};

// ── (A) intent=email-link ──────────────────────────────────────────────────────

describe('login action — intent=email-link', () => {
  it('known user → 302 to /login/verify/email with set-cookie', () => {
    callService({
      fn: 'loginAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/login',
        form: { intent: 'email-link', loginName: 'email-otp-user@acme.test' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.match(/\/login\/verify\/email(\?|$)/);
      expect(loc).to.contain('loginName=email-otp-user%40acme.test');
      expect(v.response?.setCookie).to.be.a('string');
    });
  });
});

// ── (B) /login/method loader ───────────────────────────────────────────────────

describe('/login/method loader', () => {
  it('alice@acme.test (password-only) → RENDERS the chooser, never redirects', () => {
    // Regression guard: this used to 302 to /login/password. Now that the decision
    // returns /login/method for a single method, redirecting here is a self-redirect loop.
    callService({
      fn: 'loginMethodLoader',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/login/method?loginName=alice%40acme.test',
        sessions: [ALICE_SESSION],
      },
    }).then((v) => {
      expect(v.response?.status, 'must not redirect').to.not.equal(302);
      const body = v.response?.dataBody as { methods: string[] };
      expect(body.methods).to.deep.equal(['password']);
    });
  });

  it('a sole linked IdP auto-starts the intent instead of rendering one button', () => {
    callService({
      fn: 'loginMethodLoader',
      seed: {
        users: [{ id: 'u1', loginName: 'mia@acme.test' }],
        authMethods: { u1: ['idp'] },
        idps: [{ id: 'idp-google', name: 'Google', type: 'GOOGLE' }],
        idpLinks: { u1: [{ idpId: 'idp-google', idpUserId: 'g-1' }] },
      },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        sessions: [MIA_SESSION],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc, 'goes to the provider, not /sso').to.not.contain('/sso');
      expect(loc).to.contain('idp-google');
    });
  });

  it('two linked IdPs render a picker rather than guessing one', () => {
    callService({
      fn: 'loginMethodLoader',
      seed: {
        users: [{ id: 'u1', loginName: 'mia@acme.test' }],
        authMethods: { u1: ['idp'] },
        idps: [
          { id: 'idp-google', name: 'Google', type: 'GOOGLE' },
          { id: 'idp-github', name: 'GitHub', type: 'GITHUB' },
        ],
        idpLinks: {
          u1: [
            { idpId: 'idp-google', idpUserId: 'g-1' },
            { idpId: 'idp-github', idpUserId: 'h-1' },
          ],
        },
      },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        sessions: [MIA_SESSION],
      },
    }).then((v) => {
      expect(v.response?.status).to.not.equal(302);
      const body = v.response?.dataBody as { idps: Array<{ id: string }> };
      expect(body.idps).to.have.length(2);
    });
  });

  it('idp enrolled with zero usable links never self-redirects to /login/method', () => {
    // Regression guard for the loop the previous fix round missed: the loader's OWN
    // `available` computation only counts 'idp' when a real, active, non-LDAP link
    // resolves (method.tsx:75-87) — here there are none. decideAfterIdentifier, however,
    // recomputes availability blind to that resolution (methods.includes('idp') &&
    // settings.allowExternalIdp alone), so it still names THIS route. Falling into the
    // `available.length === 0` branch and following that decision verbatim would 302 back
    // to /login/method with the exact same inputs — an infinite loop.
    callService({
      fn: 'loginMethodLoader',
      seed: {
        users: [{ id: 'u1', loginName: 'mia@acme.test' }],
        authMethods: { u1: ['idp'] },
        // No idpLinks entry for u1 at all: methods says 'idp' is enrolled, but nothing
        // resolves to a usable, linked, active, non-LDAP provider.
      },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        sessions: [MIA_SESSION],
      },
    }).then((v) => {
      // Name the destination, don't merely rule one out: `not.contain('/login/method')` also
      // passes on a 200 that renders an EMPTY chooser, which is the other way this can go wrong.
      // 'idp' enrolled means methods.length !== 0, so the policy-dead-end leg (/error) is the
      // one and only correct answer here.
      expect(v.response?.status, 'must redirect, not render an empty chooser').to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc, 'a policy dead end goes to /error').to.contain('/error');
      expect(loc, 'must never redirect back to /login/method').to.not.contain('/login/method');
    });
  });

  it('falls through and RENDERS the button when the sole-IdP intent fails to start', () => {
    // A provider that accepts the call but returns no authUrl → IDP_UNAVAILABLE. Redirecting or
    // erroring here would strand the user on a screen with nothing to press; the chooser must
    // render its one Google button so they keep a way forward (and can retry via the action).
    callService({
      fn: 'loginMethodLoader',
      seed: SOLE_IDP_SEED,
      failStartIdpIntent: true,
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        sessions: [MIA_SESSION],
      },
    }).then((v) => {
      expect(v.response?.status, 'no redirect — render the fallback').to.not.equal(302);
      const body = v.response?.dataBody as { methods: string[]; idps: Array<{ id: string }> };
      expect(body.methods).to.deep.equal(['idp']);
      expect(body.idps).to.have.length(1);
    });
  });
});

describe('/login/method loader — session gate', () => {
  // GET /id/login/method?loginName=X is CSRF-token-free and state-changing (a sole-linked-IdP
  // account makes it mint a real Zitadel intent and 302 to the provider, naming that provider).
  // Ungated it was an account-existence AND identity-provider oracle reachable by URL alone, a
  // login-CSRF vector, and a bypass of ignoreUnknownUsernames — which is honoured only in
  // resolveIdentifier. The ceremony session the identifier step already planted is the gate.
  it('bounces to /login with NO session cookie at all', () => {
    callService({
      fn: 'loginMethodLoader',
      seed: SOLE_IDP_SEED,
      request: { url: 'http://localhost/id/login/method?loginName=mia%40acme.test' },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.match(/\/login(\?|$)/);
      expect(loc, 'must not name the provider').to.not.contain('idp-google');
    });
  });

  it('bounces when the session belongs to a DIFFERENT account (no borrowing someone else)', () => {
    callService({
      fn: 'loginMethodLoader',
      seed: SOLE_IDP_SEED,
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        sessions: [ALICE_SESSION],
      },
    }).then((v) => {
      expect(v.response?.location ?? '').to.match(/\/login(\?|$)/);
    });
  });

  it('bounces when the matching session has EXPIRED (present is not live)', () => {
    callService({
      fn: 'loginMethodLoader',
      seed: SOLE_IDP_SEED,
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        sessions: [{ ...MIA_SESSION, expirationTs: '2000-01-01T00:00:00.000Z' }],
      },
    }).then((v) => {
      expect(v.response?.location ?? '').to.match(/\/login(\?|$)/);
    });
  });

  it('accepts a session whose loginName differs only in CASE', () => {
    // The URL carries the provider's canonical loginName; a hand-typed or IdP-returned
    // identifier may differ in case. An exact compare would lock out a legitimate arrival.
    callService({
      fn: 'loginMethodLoader',
      seed: {
        users: [{ id: 'u1', loginName: 'mia@acme.test' }],
        authMethods: { u1: ['password'] },
      },
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        sessions: [{ ...MIA_SESSION, loginName: 'MIA@Acme.Test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.not.equal(302);
      expect((v.response?.dataBody as { methods: string[] }).methods).to.deep.equal(['password']);
    });
  });

  it('threads requestId + organization onto the bounce so the ceremony survives', () => {
    callService({
      fn: 'loginMethodLoader',
      seed: SOLE_IDP_SEED,
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test&requestId=oidc_1&organization=org-1',
      },
    }).then((v) => {
      const loc = v.response?.location ?? '';
      expect(loc).to.contain('requestId=oidc_1');
      expect(loc).to.contain('organization=org-1');
    });
  });
});

describe('login action — retires the one-shot auto-start marker', () => {
  it('expires idp-autostart so the NEXT ceremony can auto-start again', () => {
    // The marker suppresses a second auto-start for the same loginName, which is what stops the
    // Back-from-the-provider arrival re-minting an intent. Its 10-minute maxAge outlived the
    // ceremony that wrote it, so a sign-out/sign-in inside that window got the one-button chooser
    // instead of the auto-start. The identifier submit IS a new ceremony, so it clears the marker
    // — Back never re-POSTs here, so the guard the marker provides is untouched.
    callService({
      fn: 'loginAction',
      seed: {
        users: [{ id: 'u1', loginName: 'alice@acme.test' }],
        authMethods: { u1: ['password'] },
      },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/login',
        form: { loginName: 'alice@acme.test' },
        csrf: true,
        idpAutostart: 'alice@acme.test',
      },
    }).then((v) => {
      const cleared = (v.response?.setCookies ?? []).find((c) => c.startsWith('idp-autostart='));
      expect(cleared, 'the action emits an idp-autostart cookie').to.be.a('string');
      // Expiry, not a rewrite: Max-Age=0 is what actually retires it in the browser.
      expect(cleared ?? '', 'expired, not re-armed').to.contain('Max-Age=0');
    });
  });
});

describe('/login/method loader — ONE-SHOT sole-IdP auto-start', () => {
  // The auto-start lives in a LOADER, which re-runs on every arrival at the URL — including the
  // one the browser makes when the user presses Back at the provider. Unguarded that Back mints
  // a NEW intent and bounces them straight forward again: they can never return to the app.
  it('FIRST arrival still auto-starts, and marks the browser', () => {
    callService({
      fn: 'loginMethodLoader',
      seed: SOLE_IDP_SEED,
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        sessions: [MIA_SESSION],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.contain('idp-google');
      expect(v.response?.setCookie ?? '', 'writes the one-shot marker').to.contain('idp-autostart');
    });
  });

  it('SECOND arrival for the same account renders the chooser instead of re-minting', () => {
    callService({
      fn: 'loginMethodLoader',
      seed: SOLE_IDP_SEED,
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        sessions: [MIA_SESSION],
        idpAutostart: 'mia@acme.test',
      },
      recordCalls: ['startIdpIntent'],
    }).then((v) => {
      expect(v.response?.status, 'must not redirect to the provider again').to.not.equal(302);
      expect(v.calls?.startIdpIntent, 'no new Zitadel intent minted').to.have.length(0);
      const body = v.response?.dataBody as { methods: string[]; idps: Array<{ id: string }> };
      expect(body.methods).to.deep.equal(['idp']);
      expect(body.idps, 'the chooser offers the provider as a button').to.have.length(1);
    });
  });

  it('a marker for a DIFFERENT account does not suppress this one', () => {
    callService({
      fn: 'loginMethodLoader',
      seed: SOLE_IDP_SEED,
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        sessions: [MIA_SESSION],
        idpAutostart: 'someone-else@acme.test',
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.contain('idp-google');
    });
  });

  it("gates on the USER's own org policy, not the default org's, with no ?organization", () => {
    // resolveIdentifier decides with `org ?? user.orgId` (login.service.ts) — the org the found
    // user actually belongs to — and it is what routed the user here. This loader must gate on
    // the same policy. When it resolved settings default-org-first instead, any user outside the
    // default org signing in without an explicit ?organization got their method approved by one
    // policy and then computed away by another: available=[] and a bounce to /error, on the most
    // travelled path in the product. Here the default org forbids passwords and mia's org does
    // not, so reading the wrong one is a redirect instead of a render.
    callService({
      fn: 'loginMethodLoader',
      seed: {
        users: [{ id: 'u1', loginName: 'mia@acme.test', orgId: 'org-mia' }],
        authMethods: { u1: ['password'] },
        settingsByOrg: { 'org-default-fake': { allowPassword: false } },
      },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        sessions: [MIA_SESSION],
      },
    }).then((v) => {
      expect(v.response?.status, 'must not bounce to /error').to.not.equal(302);
      const body = v.response?.dataBody as { methods: string[] };
      expect(body.methods).to.deep.equal(['password']);
    });
  });

  it("resolves idps to only this user's linked (active, non-LDAP) providers", () => {
    // Google is active AND linked to u1; GitHub is active but NOT linked — must not surface.
    callService({
      fn: 'loginMethodLoader',
      seed: {
        users: [{ id: 'u1', loginName: 'mia@acme.test' }],
        authMethods: { u1: ['password', 'idp'] },
        idps: [
          { id: 'idp-google', name: 'Google', type: 'GOOGLE' },
          { id: 'idp-github', name: 'GitHub', type: 'GITHUB' },
        ],
        idpLinks: { u1: [{ idpId: 'idp-google', idpUserId: 'g-1' }] },
      },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        sessions: [MIA_SESSION],
      },
    }).then((v) => {
      const body = v.response?.dataBody as { methods: string[]; idps: Array<{ id: string }> };
      expect(body.methods).to.include('idp');
      expect(body.idps).to.deep.equal([{ id: 'idp-google', name: 'Google', type: 'GOOGLE' }]);
    });
  });
});

describe('/login/method action — intent=idp', () => {
  it('a linked IdP starts the OAuth round-trip (redirects to the authUrl)', () => {
    callService({
      fn: 'loginMethodAction',
      seed: {
        users: [{ id: 'u1', loginName: 'mia@acme.test' }],
        authMethods: { u1: ['password', 'idp'] },
        idps: [{ id: 'idp-google', name: 'Google', type: 'GOOGLE' }],
        idpLinks: { u1: [{ idpId: 'idp-google', idpUserId: 'g-1' }] },
      },
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        form: { intent: 'idp', idpId: 'idp-google' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.contain('idp-google');
    });
  });

  it('rejects an idpId that is active in the org but NOT linked to this user', () => {
    // Never trust the client's idpId — a crafted POST for an active-but-unlinked provider
    // must not start a round-trip, mirroring reauth.tsx's own defense-in-depth check.
    callService({
      fn: 'loginMethodAction',
      seed: {
        users: [{ id: 'u1', loginName: 'mia@acme.test' }],
        authMethods: { u1: ['password', 'idp'] },
        idps: [
          { id: 'idp-google', name: 'Google', type: 'GOOGLE' },
          { id: 'idp-github', name: 'GitHub', type: 'GITHUB' },
        ],
        idpLinks: { u1: [{ idpId: 'idp-google', idpUserId: 'g-1' }] },
      },
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        form: { intent: 'idp', idpId: 'idp-github' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataStatus).to.equal(400);
    });
  });
});
