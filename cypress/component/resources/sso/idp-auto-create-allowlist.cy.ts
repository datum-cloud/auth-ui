// cypress/component/resources/sso/idp-auto-create-allowlist.cy.ts
//
// TEMPORARY (staging dual-org interim) — see app/resources/sso/idp-auto-create-allowlist.ts and
// docs/architecture/adrs/007-staging-idp-auto-create-allowlist.md. Delete with that module.
//
// An org whose login policy disallows registration (the staff org) still lets an IdP-VERIFIED
// email from an allow-listed domain auto-create a user, behind IDP_AUTO_CREATE_EMAIL_DOMAINS.
// When that same email already owns a user in ANOTHER org (Zitadel usernames are unique
// instance-wide and auth-ui uses the email as the username), the user is created under the
// `local+<tag>@domain` alias instead — the convention admins applied by hand until now.
//
// The OFF state is pinned first: with the flag unset, every case below is today's
// creation-disabled dead end, so production (which never sets the flag) is untouched.
//
// Node-bound (real signed cookies, DI'd IdP intent) → cy.task node-spec harness.
import { callService, type AuditEvent, type Scenario } from '../../../support/node/call-service';

const STAFF_ORG = 'org-staff';
const CLOUD_ORG = 'org-cloud';
const FLAGS_ON = {
  IDP_AUTO_CREATE_EMAIL_DOMAINS: 'datum.net',
  IDP_AUTO_CREATE_ORGS: STAFF_ORG,
  ALLOW_IDP_AUTO_LINK: 'true',
};

function intent(email: string, emailVerified = true): Scenario['idpIntent'] {
  return {
    userId: null,
    information: { idpId: 'idp-sso', idpUserId: `g-${email}`, idpUserName: email },
    draft: { email, firstName: 'New', lastName: 'Staff', emailVerified },
  };
}
// The staff portal pins its org: the callback URL carries ?organization=<staff org>.
const CB = `https://auth.localtest.me/sso/google/callback?id=intent-1&token=tok-1&organization=${STAFF_ORG}`;
const REGISTRATION_OFF = { allowRegister: false };
const isSignedInOrAuthorize = (loc: string) => loc === '/signed-in' || loc.startsWith('/authorize');

function registerCalls(v: { calls?: Record<string, unknown[]> }) {
  return (v.calls?.['register'] ?? []) as Array<[{ email?: string; orgId?: string }]>;
}
function find(audit: AuditEvent[], event: string, outcome: string) {
  return audit.find((e) => e.event === event && e.outcome === outcome);
}

describe('IdP auto-create allow-list — OFF (flag unset): registration-off orgs stay closed', () => {
  it('a verified allow-listed-domain email still gets creation-disabled and nothing is registered', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {},
      mockLoginSettings: REGISTRATION_OFF,
      idpIntent: intent('new@datum.net'),
      request: { url: CB },
      recordCalls: ['register'],
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.include('reason=creation-disabled');
      expect(registerCalls(v).length, 'no register call').to.equal(0);
    });
  });
});

describe('IdP auto-create allow-list — ON (IDP_AUTO_CREATE_EMAIL_DOMAINS=datum.net)', () => {
  it('creates and signs in a verified @datum.net identity in the registration-off org', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: FLAGS_ON,
      seed: {},
      mockLoginSettings: REGISTRATION_OFF,
      idpIntent: intent('new@datum.net'),
      request: { url: CB },
      recordCalls: ['register'],
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(isSignedInOrAuthorize(v.response?.location ?? ''), 'signed in').to.equal(true);
      const [call] = registerCalls(v);
      expect(call?.[0]?.email, 'registered under the real email').to.equal('new@datum.net');
      expect(call?.[0]?.orgId, 'registered into the pinned org').to.equal(STAFF_ORG);
      const ev = find(v.audit, 'idp.register', 'success');
      expect(ev?.viaDomainAllowlist, 'audit marks the allow-list door').to.equal(true);
      expect(ev?.aliased, 'no alias needed').to.equal(false);
    });
  });

  it('a domain outside the allow-list stays creation-disabled', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: FLAGS_ON,
      seed: {},
      mockLoginSettings: REGISTRATION_OFF,
      idpIntent: intent('someone@gmail.com'),
      request: { url: CB },
      recordCalls: ['register'],
    }).then((v) => {
      expect(v.response?.location ?? '').to.include('reason=creation-disabled');
      expect(registerCalls(v).length).to.equal(0);
    });
  });

  it('an allow-listed domain the IdP did NOT verify stays creation-disabled', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: FLAGS_ON,
      seed: {},
      mockLoginSettings: REGISTRATION_OFF,
      idpIntent: intent('new@datum.net', false),
      request: { url: CB },
      recordCalls: ['register'],
    }).then((v) => {
      expect(v.response?.location ?? '').to.include('reason=creation-disabled');
      expect(registerCalls(v).length).to.equal(0);
    });
  });

  it('email already owned by a user in ANOTHER org → registers the +staff alias in the pinned org', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: FLAGS_ON,
      seed: { users: [{ id: 'u-cloud', loginName: 'new@datum.net', orgId: CLOUD_ORG }] },
      mockLoginSettings: REGISTRATION_OFF,
      idpIntent: intent('new@datum.net'),
      request: { url: CB },
      recordCalls: ['register', 'addIdpLink'],
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(isSignedInOrAuthorize(v.response?.location ?? ''), 'signed in').to.equal(true);
      const [call] = registerCalls(v);
      expect(call?.[0]?.email, 'alias username/email').to.equal('new+staff@datum.net');
      expect(call?.[0]?.orgId).to.equal(STAFF_ORG);
      expect(find(v.audit, 'idp.register', 'success')?.aliased).to.equal(true);
      // The other org's user is NOT touched: no link is attached to u-cloud.
      const links = (v.calls?.['addIdpLink'] ?? []) as Array<[string]>;
      expect(
        links.some((l) => l[0] === 'u-cloud'),
        'no link onto the other org user'
      ).to.equal(false);
    });
  });

  it('alias already exists in the pinned org (passwordless) → auto-links it instead of registering', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: FLAGS_ON,
      seed: {
        users: [
          { id: 'u-cloud', loginName: 'new@datum.net', orgId: CLOUD_ORG },
          { id: 'u-alias', loginName: 'new+staff@datum.net', orgId: STAFF_ORG },
        ],
      },
      mockLoginSettings: REGISTRATION_OFF,
      idpIntent: intent('new@datum.net'),
      request: { url: CB },
      recordCalls: ['register', 'addIdpLink'],
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(isSignedInOrAuthorize(v.response?.location ?? ''), 'signed in').to.equal(true);
      expect(registerCalls(v).length, 'no new user').to.equal(0);
      const links = (v.calls?.['addIdpLink'] ?? []) as Array<[string]>;
      expect(links[0]?.[0], 'linked onto the existing alias user').to.equal('u-alias');
    });
  });

  it('pinned org NOT in IDP_AUTO_CREATE_ORGS → creation-disabled even for an allow-listed domain', () => {
    // The door is confined to the listed org(s): the callback's org falls back to the raw
    // ?organization= query param, so without this pin any registration-off org on the instance
    // (including per-project machine-account orgs) would become a valid self-provisioning target.
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ...FLAGS_ON, IDP_AUTO_CREATE_ORGS: 'org-some-other' },
      seed: {},
      mockLoginSettings: REGISTRATION_OFF,
      idpIntent: intent('new@datum.net'),
      request: { url: CB },
      recordCalls: ['register'],
    }).then((v) => {
      expect(v.response?.location ?? '').to.include('reason=creation-disabled');
      expect(registerCalls(v).length).to.equal(0);
    });
  });

  it('alias exists only in a THIRD org → not treated as the target org account; fails closed as registration-conflict', () => {
    // Proves the alias lookup is scoped to the pinned org: linking onto a user in another org
    // would mint an identity the pinned request can never finalize (org guard), so the plain
    // username being taken instance-wide must surface as a conflict instead.
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: FLAGS_ON,
      seed: {
        users: [
          { id: 'u-cloud', loginName: 'new@datum.net', orgId: CLOUD_ORG },
          { id: 'u-third', loginName: 'new+staff@datum.net', orgId: 'org-third' },
        ],
      },
      mockLoginSettings: REGISTRATION_OFF,
      idpIntent: intent('new@datum.net'),
      request: { url: CB },
      recordCalls: ['register', 'addIdpLink'],
    }).then((v) => {
      expect(v.response?.location ?? '').to.include('reason=registration-conflict');
      const links = (v.calls?.['addIdpLink'] ?? []) as Array<[string]>;
      expect(
        links.some((l) => l[0] === 'u-third'),
        'no link onto the third-org user'
      ).to.equal(false);
    });
  });

  it('same-email user in the SAME org (passwordless) → existing auto-link path, no alias', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: FLAGS_ON,
      seed: { users: [{ id: 'u-staff', loginName: 'new@datum.net', orgId: STAFF_ORG }] },
      mockLoginSettings: REGISTRATION_OFF,
      idpIntent: intent('new@datum.net'),
      request: { url: CB },
      recordCalls: ['register', 'addIdpLink'],
    }).then((v) => {
      expect(isSignedInOrAuthorize(v.response?.location ?? ''), 'signed in').to.equal(true);
      expect(registerCalls(v).length).to.equal(0);
      const links = (v.calls?.['addIdpLink'] ?? []) as Array<[string]>;
      expect(links[0]?.[0]).to.equal('u-staff');
    });
  });
});
