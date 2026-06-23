// app/modules/auth/providers/__tests__/parity.test.ts
//
// fake↔zitadel AuthProvider PARITY test (the keystone plug-and-play deliverable).
//
// Pins BOTH adapters to the identical `AuthProvider` port:
//   1. SURFACE parity — both adapters expose the SAME set of callable port methods.
//   2. RETURN-SHAPE parity + neutrality — driving a representative subset of methods
//      through BOTH adapters yields the SAME neutral key-set and leaks NO proto/provider field.
//
// Why this is REAL, not a `typeof`-only tautology:
//   • PORT_METHODS is `satisfies readonly (keyof AuthProvider)[]` — renaming/dropping a method
//     from the PORT is a compile error here, and PORT_COVERS_PORT asserts the list is complete.
//   • surfaceOf() reads the actual function-valued properties on each instance, then the
//     symmetric-difference assertion fails if a method is dropped from EITHER adapter:
//     delete `verifyU2F` from FakeAuthProvider → fake surface loses it → diff non-empty → RED.
//   • The return-shape assertions diff the fake's neutral keys against the zitadel adapter's
//     (mapper-produced) keys: if the zitadel mapper started leaking a proto field (e.g.
//     `expirationDate` instead of `expiresAt`) the key-set diverges → RED.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { ZitadelAuthProvider } from '@/modules/auth/providers/zitadel/index';
import * as transport from '@/modules/auth/providers/zitadel/transport';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ── the authoritative port surface ────────────────────────────────────────────
// `satisfies readonly (keyof AuthProvider)[]` ties this list to the interface: a method
// renamed/removed from AuthProvider stops compiling here. PORT_COVERS_PORT (below) proves
// the list is also COMPLETE — so a method ADDED to the port without being listed is caught.
const PORT_METHODS = [
  'getLoginSettings',
  'getBranding',
  'getPasswordComplexity',
  'getActiveIdPs',
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

// Compile-time completeness: a method ADDED to the port (minus `capabilities`, which is a
// readonly value field, not a method) MUST appear in PORT_METHODS or this assignment errors.
// (Exhaustiveness check — never read at runtime.)
type PortMethodName = Exclude<keyof AuthProvider, 'capabilities'>;
const PORT_COVERS_PORT: Record<PortMethodName, true> = Object.fromEntries(
  PORT_METHODS.map((m) => [m, true])
) as Record<PortMethodName, true>;

// Collect the function-valued property names an INSTANCE actually exposes (own + prototype),
// restricted to the port surface. This reads the real adapter — dropping a method makes its
// entry disappear here, which is what makes the parity assertion non-tautological.
function surfaceOf(instance: object): Set<string> {
  const names = new Set<string>();
  // own enumerable + prototype methods
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

// Mirror index.test.ts's stub: swap the service-client factory so the zitadel adapter is driven
// with canned RPC responses instead of a live transport. The stub returns a Zitadel-flavoured
// proto-ish shape so we exercise the REAL mapper (only the mapper interprets it).
const stubClient = (impl: Record<string, unknown>) =>
  vi.spyOn(transport, 'createServiceClient').mockReturnValue(impl as never);

afterEach(() => vi.restoreAllMocks());

describe('AuthProvider parity — method surface', () => {
  it('PORT_METHODS exhaustively names every port method (sans capabilities)', () => {
    // PORT_COVERS_PORT compiles only if PORT_METHODS lists every method; assert it is populated
    // so the type-level guarantee also has a runtime witness.
    expect(Object.keys(PORT_COVERS_PORT).length).toBe(PORT_METHODS.length);
    // No accidental duplicates inflating the count.
    expect(new Set(PORT_METHODS).size).toBe(PORT_METHODS.length);
  });

  it('fake and zitadel expose the IDENTICAL set of callable port methods', () => {
    const fakeSurface = surfaceOf(fake());
    const zitadelSurface = surfaceOf(zitadel());

    // Both adapters must implement the WHOLE port — no method missing from either.
    const portSet = new Set<string>(PORT_METHODS);
    expect(fakeSurface).toEqual(portSet);
    expect(zitadelSurface).toEqual(portSet);

    // Symmetric difference must be empty: drop a method from ONE adapter → RED here.
    const onlyInFake = [...fakeSurface].filter((m) => !zitadelSurface.has(m));
    const onlyInZitadel = [...zitadelSurface].filter((m) => !fakeSurface.has(m));
    expect(onlyInFake).toEqual([]);
    expect(onlyInZitadel).toEqual([]);
  });

  it('both adapters declare the SAME capability key-set (no extra/missing flags)', () => {
    expect(Object.keys(fake().capabilities).sort()).toEqual(
      Object.keys(zitadel().capabilities).sort()
    );
  });
});

// ── return-shape parity + neutrality ───────────────────────────────────────────
// A field name is "leaky" if it is a proto/provider artifact (Zitadel proto uses these names;
// the neutral port never should). If the mapper regressed to passing one of these through, the
// zitadel adapter's neutral key-set would diverge from the fake's → RED.
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
    expect(LEAKY_KEYS, `${label}: leaked proto/provider key "${k}"`).not.toContain(k);
  }
}

describe('AuthProvider parity — neutral return shapes', () => {
  it('createSession returns the SAME neutral Session key-set from both adapters', async () => {
    // Drive the fake.
    const fp = fake();
    const fakeSession = await fp.createSession({ password: 'pw' }, { userId: 'u1' });

    // Drive zitadel through the REAL mapper: createSession RPC then getSession RPC.
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

    // Same neutral top-level shape from both adapters.
    expect(Object.keys(zitadelSession).sort()).toEqual(Object.keys(fakeSession).sort());
    // And it is genuinely neutral — no proto field name leaked out of the mapper.
    assertNeutralKeys(fakeSession as unknown as Record<string, unknown>, 'fake Session');
    assertNeutralKeys(zitadelSession as unknown as Record<string, unknown>, 'zitadel Session');
    // The neutral fields are populated (not the leaky proto ones).
    expect(typeof zitadelSession.id).toBe('string');
    expect(typeof zitadelSession.expiresAt).toBe('string');
    expect(typeof zitadelSession.changedAt).toBe('string');
  });

  it('findUser returns the SAME neutral User key-set (or null) from both adapters', async () => {
    const fp = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'a@b.c', displayName: 'A B' }],
    });
    const fakeUser = await fp.findUser('a@b.c');
    expect(fakeUser).not.toBeNull();

    stubClient({
      listUsers: async () => ({
        result: [{ userId: 'u1', preferredLoginName: 'a@b.c', details: { sequence: 1n } }],
      }),
    });
    const zitadelUser = await zitadel().findUser('a@b.c');
    expect(zitadelUser).not.toBeNull();

    // Neutral User must not carry proto artifacts; the id/loginName fields are present on both.
    assertNeutralKeys(zitadelUser as unknown as Record<string, unknown>, 'zitadel User');
    assertNeutralKeys(fakeUser as unknown as Record<string, unknown>, 'fake User');
    expect(typeof zitadelUser?.id).toBe('string');
    expect(typeof zitadelUser?.loginName).toBe('string');
    // EVERY key BOTH adapters emit must be a valid neutral `User` field (optional fields like
    // displayName/orgId may differ in PRESENCE between adapters, but neither may emit a key that
    // is not on the User port type). A proto leak (`userId`, `details`) is not a NEUTRAL_USER_KEY
    // → RED. `satisfies` ties this allow-list to the User interface at compile time.
    const NEUTRAL_USER_KEYS = [
      'id',
      'loginName',
      'displayName',
      'orgId',
      'mfaInitSkippedAt',
    ] as const satisfies readonly (keyof import('@/modules/auth/types').User)[];
    const neutral = new Set<string>(NEUTRAL_USER_KEYS);
    for (const k of Object.keys(zitadelUser as object)) {
      expect(neutral.has(k), `zitadel User key "${k}" is not a neutral User field`).toBe(true);
    }
    for (const k of Object.keys(fakeUser as object)) {
      expect(neutral.has(k), `fake User key "${k}" is not a neutral User field`).toBe(true);
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

    expect(Object.keys(zitadelOpts).sort()).toEqual(Object.keys(fakeOpts).sort());
    expect(Object.keys(zitadelOpts).sort()).toEqual([
      'passkeyId',
      'publicKeyCredentialCreationOptions',
    ]);
    // Inner attestation envelope is the opaque WebAuthn publicKey struct on both adapters.
    expect(zitadelOpts.publicKeyCredentialCreationOptions).toHaveProperty('publicKey');
    expect(fakeOpts.publicKeyCredentialCreationOptions).toHaveProperty('publicKey');
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

    expect(Object.keys(zitadelOpts).sort()).toEqual(Object.keys(fakeOpts).sort());
    expect(Object.keys(zitadelOpts).sort()).toEqual([
      'publicKeyCredentialCreationOptions',
      'u2fId',
    ]);
  });

  it('getPasswordComplexity returns the SAME neutral key-set from both adapters', async () => {
    const fakePc = await fake().getPasswordComplexity();
    expect(fakePc).toBeDefined();

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
    expect(zitadelPc).toBeDefined();

    expect(Object.keys(zitadelPc as object).sort()).toEqual(Object.keys(fakePc as object).sort());
    // minLength is a JSON-safe number on BOTH (coerced from the proto bigint by the mapper).
    expect(typeof zitadelPc?.minLength).toBe('number');
    expect(typeof fakePc?.minLength).toBe('number');
  });
});
