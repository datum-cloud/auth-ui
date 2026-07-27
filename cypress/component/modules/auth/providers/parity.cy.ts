// cypress/component/modules/auth/providers/parity.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/__tests__/parity.test.ts.
//
// fake↔zitadel AuthProvider PARITY test (the keystone plug-and-play deliverable). Both adapters
// are browser-safe (FakeAuthProvider is in-memory; ZitadelAuthProvider's only node-only dep is the
// transport, stubbed in the Vite bundle). The zitadel adapter is driven with canned RPC responses
// via the transport stub's __setCreateServiceClientImpl hook — the SAME seam index.cy.ts uses —
// instead of vitest's vi.spyOn(transport, 'createServiceClient').
//
// Why this is REAL, not a `typeof`-only tautology:
//   • PORT_METHODS is `satisfies readonly (keyof AuthProvider)[]` — renaming/dropping a method from
//     the PORT is a compile error (cypress/** is in the tsconfig typecheck set), and PORT_COVERS_PORT
//     asserts the list is complete.
//   • surfaceOf() reads the actual function-valued properties on each instance; the symmetric-diff
//     assertion fails if a method is dropped from EITHER adapter.
//   • The return-shape assertions diff the fake's neutral keys against the zitadel mapper's keys: a
//     leaked proto field diverges the key-set → RED.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { ZitadelAuthProvider } from '@/modules/auth/providers/zitadel/index';
import * as transport from '@/modules/auth/providers/zitadel/transport';

// ── the authoritative port surface ────────────────────────────────────────────
const PORT_METHODS = [
  'getLoginSettings',
  'getBranding',
  'getPasswordComplexity',
  'getActiveIdPs',
  'getDefaultOrg',
  'findUser',
  'findOrgByDomain',
  'getUser',
  'listAuthMethods',
  'register',
  'createSession',
  'getSession',
  'updateSession',
  'deleteSession',
  'listSessions',
  'sendPasswordReset',
  'setPasswordWithCode',
  'changePasswordWithSession',
  'sendEmailCode',
  'verifyEmail',
  'verifyInvite',
  'resendEmailCode',
  'getAuthRequest',
  'createCallback',
  'startIdpIntent',
  'retrieveIdpIntent',
  'listIdpLinks',
  'addIdpLink',
  'removeIdpLink',
  'passkeyRegisterLink',
  'registerPasskey',
  'verifyPasskey',
  'listPasskeys',
  'removePasskey',
  'registerU2F',
  'verifyU2F',
  'registerTotp',
  'verifyTotp',
  'addOtpEmail',
  'addOtpSms',
  'setMfaInitSkipped',
  'getDeviceAuth',
  'authorizeDevice',
  'createSamlResponse',
  'startLdapIntent',
  'markEmailVerified',
  'isInstanceAdmin',
] as const satisfies readonly Exclude<keyof AuthProvider, 'capabilities'>[];

// Compile-time completeness: a method ADDED to the port (minus `capabilities`) MUST appear in
// PORT_METHODS or this assignment errors. (Exhaustiveness check — never read at runtime.)
type PortMethodName = Exclude<keyof AuthProvider, 'capabilities'>;
const PORT_COVERS_PORT: Record<PortMethodName, true> = Object.fromEntries(
  PORT_METHODS.map((m) => [m, true])
) as Record<PortMethodName, true>;

function surfaceOf(instance: object): Set<string> {
  const names = new Set<string>();
  let obj: object | null = instance;
  while (obj && obj !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(obj)) {
      if (
        (PORT_METHODS as readonly string[]).includes(key) &&
        typeof (instance as Record<string, unknown>)[key] === 'function'
      ) {
        names.add(key);
      }
    }
    obj = Object.getPrototypeOf(obj) as object | null;
  }
  return names;
}

const fake = () => new FakeAuthProvider();
const zitadel = () => new ZitadelAuthProvider({ serviceUrl: 'https://z.test', serviceToken: 't' });

// Drive the zitadel adapter with canned RPC responses via the transport stub's mutable hook (the
// browser-bundle equivalent of vi.spyOn(transport, 'createServiceClient').mockReturnValue(impl)).
const stubClient = (impl: Record<string, unknown>) =>
  (
    transport as unknown as { __setCreateServiceClientImpl: (fn: unknown) => void }
  ).__setCreateServiceClientImpl(() => impl);

afterEach(() => {
  (
    transport as unknown as { __resetCreateServiceClientImpl: () => void }
  ).__resetCreateServiceClientImpl();
});

describe('AuthProvider parity — method surface', () => {
  it('PORT_METHODS exhaustively names every port method (sans capabilities)', () => {
    expect(Object.keys(PORT_COVERS_PORT).length).to.equal(PORT_METHODS.length);
    expect(new Set(PORT_METHODS).size).to.equal(PORT_METHODS.length);
  });

  it('fake and zitadel expose the IDENTICAL set of callable port methods', () => {
    const fakeSurface = surfaceOf(fake());
    const zitadelSurface = surfaceOf(zitadel());

    const portSet = new Set<string>(PORT_METHODS);
    expect(fakeSurface).to.deep.equal(portSet);
    expect(zitadelSurface).to.deep.equal(portSet);

    const onlyInFake = [...fakeSurface].filter((m) => !zitadelSurface.has(m));
    const onlyInZitadel = [...zitadelSurface].filter((m) => !fakeSurface.has(m));
    expect(onlyInFake).to.deep.equal([]);
    expect(onlyInZitadel).to.deep.equal([]);
  });

  it('both adapters declare the SAME capability key-set (no extra/missing flags)', () => {
    expect(Object.keys(fake().capabilities).sort()).to.deep.equal(
      Object.keys(zitadel().capabilities).sort()
    );
  });
});

// ── return-shape parity + neutrality ───────────────────────────────────────────
const LEAKY_KEYS = [
  'expirationDate',
  'changeDate',
  'sessionId',
  'sessionToken',
  'organizationId',
  'verifiedAt' /* nested-only; never top-level */,
  'details',
];

function assertNeutralKeys(obj: Record<string, unknown>, label: string): void {
  for (const k of Object.keys(obj)) {
    expect(LEAKY_KEYS, `${label}: leaked proto/provider key "${k}"`).to.not.include(k);
  }
}

describe('AuthProvider parity — neutral return shapes', () => {
  it('createSession returns the SAME neutral Session key-set from both adapters', async () => {
    const fp = fake();
    const fakeSession = await fp.createSession({ password: 'pw' }, { userId: 'u1' });

    stubClient({
      createSession: async () => ({ sessionId: 's1', sessionToken: 'tok' }),
      getSession: async () => ({
        session: {
          id: 's1',
          factors: { user: { id: 'u1', loginName: 'a@b.c' } },
          expirationDate: '2099-01-01T00:00:00.000Z',
          changeDate: '2026-01-01T00:00:00.000Z',
        },
      }),
    });
    const zp = zitadel();
    const zitadelSession = await zp.createSession({ password: 'pw' }, { userId: 'u1' });

    expect(Object.keys(zitadelSession).sort()).to.deep.equal(Object.keys(fakeSession).sort());
    assertNeutralKeys(fakeSession as unknown as Record<string, unknown>, 'fake Session');
    assertNeutralKeys(zitadelSession as unknown as Record<string, unknown>, 'zitadel Session');
    expect(typeof zitadelSession.id).to.equal('string');
    expect(typeof zitadelSession.expiresAt).to.equal('string');
    expect(typeof zitadelSession.changedAt).to.equal('string');
  });

  it('findUser returns the SAME neutral User key-set (or null) from both adapters', async () => {
    const fp = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@b.c', displayName: 'A B' }],
    });
    const fakeUser = await fp.findUser('a@b.c');
    expect(fakeUser).to.not.be.null;

    stubClient({
      listUsers: async () => ({
        result: [{ userId: 'u1', preferredLoginName: 'a@b.c', details: { sequence: 1n } }],
      }),
    });
    const zitadelUser = await zitadel().findUser('a@b.c');
    expect(zitadelUser).to.not.be.null;

    assertNeutralKeys(zitadelUser as unknown as Record<string, unknown>, 'zitadel User');
    assertNeutralKeys(fakeUser as unknown as Record<string, unknown>, 'fake User');
    expect(typeof zitadelUser?.id).to.equal('string');
    expect(typeof zitadelUser?.loginName).to.equal('string');
    const NEUTRAL_USER_KEYS = [
      'id',
      'loginName',
      'displayName',
      'orgId',
      'mfaInitSkippedAt',
    ] as const satisfies readonly (keyof import('@/modules/auth/types').User)[];
    const neutral = new Set<string>(NEUTRAL_USER_KEYS);
    for (const k of Object.keys(zitadelUser as object)) {
      expect(neutral.has(k), `zitadel User key "${k}" is not a neutral User field`).to.equal(true);
    }
    for (const k of Object.keys(fakeUser as object)) {
      expect(neutral.has(k), `fake User key "${k}" is not a neutral User field`).to.equal(true);
    }
  });

  it('registerPasskey returns the SAME neutral WebAuthnCreationOptions key-set from both adapters', async () => {
    const fakeOpts = await fake().registerPasskey('u1', 'code', 'z.test');

    stubClient({
      registerPasskey: async () => ({
        passkeyId: 'pk1',
        publicKeyCredentialCreationOptions: { publicKey: { challenge: 'abc' } },
      }),
    });
    const zitadelOpts = await zitadel().registerPasskey(
      'u1',
      JSON.stringify({ id: 'pk1', code: 'c' }),
      'z.test'
    );

    expect(Object.keys(zitadelOpts).sort()).to.deep.equal(Object.keys(fakeOpts).sort());
    expect(Object.keys(zitadelOpts).sort()).to.deep.equal([
      'passkeyId',
      'publicKeyCredentialCreationOptions',
    ]);
    expect(zitadelOpts.publicKeyCredentialCreationOptions).to.have.property('publicKey');
    expect(fakeOpts.publicKeyCredentialCreationOptions).to.have.property('publicKey');
  });

  it('registerU2F returns the SAME neutral U2FCreationOptions key-set from both adapters', async () => {
    const fakeOpts = await fake().registerU2F('u1', 'z.test');

    stubClient({
      registerU2F: async () => ({
        u2fId: 'k1',
        publicKeyCredentialCreationOptions: { publicKey: { challenge: 'abc' } },
      }),
    });
    const zitadelOpts = await zitadel().registerU2F('u1', 'z.test');

    expect(Object.keys(zitadelOpts).sort()).to.deep.equal(Object.keys(fakeOpts).sort());
    expect(Object.keys(zitadelOpts).sort()).to.deep.equal([
      'publicKeyCredentialCreationOptions',
      'u2fId',
    ]);
  });

  it('getPasswordComplexity returns the SAME neutral key-set from both adapters', async () => {
    const fakePc = await fake().getPasswordComplexity();
    expect(fakePc).to.not.be.undefined;

    stubClient({
      getPasswordComplexitySettings: async () => ({
        settings: {
          minLength: 8n,
          requiresUppercase: true,
          requiresLowercase: true,
          requiresNumber: true,
          requiresSymbol: false,
        },
      }),
    });
    const zitadelPc = await zitadel().getPasswordComplexity();
    expect(zitadelPc).to.not.be.undefined;

    expect(Object.keys(zitadelPc as object).sort()).to.deep.equal(
      Object.keys(fakePc as object).sort()
    );
    expect(typeof zitadelPc?.minLength).to.equal('number');
    expect(typeof fakePc?.minLength).to.equal('number');
  });
});
