// app/providers/zitadel/index.test.ts
import { ZitadelAuthProvider } from '../index';
import * as transport from '../transport';
import { ProviderError } from '@/modules/auth/types';
import { describe, it, expect, vi, afterEach } from 'vitest';

const provider = () => new ZitadelAuthProvider({ serviceUrl: 'https://z.test', serviceToken: 't' });

// Stub the service-client factory so we drive the branching with canned responses.
const stubClient = (impl: Record<string, unknown>) =>
  vi.spyOn(transport, 'createServiceClient').mockReturnValue(impl as never);

describe('ZitadelAuthProvider — method surface', () => {
  it('exposes the 12 Phase 1 methods (getLegalSupport removed)', () => {
    const p = provider() as unknown as Record<string, unknown>;
    for (const m of [
      'getLoginSettings',
      'getBranding',
      'getPasswordComplexity',
      'findUser',
      'getUser',
      'listAuthMethods',
      'createSession',
      'getSession',
      'updateSession',
      'deleteSession',
      'getAuthRequest',
      'createCallback',
    ]) {
      expect(typeof p[m]).toBe('function');
    }
  });
});

describe('ZitadelAuthProvider — pure branching', () => {
  it('findUser returns null when listUsers yields 0 results', async () => {
    stubClient({ listUsers: async () => ({ result: [] }) });
    expect(await provider().findUser('a@b.c')).toBeNull();
  });
  it('findUser returns null when listUsers yields 2 results (ambiguous)', async () => {
    stubClient({ listUsers: async () => ({ result: [{ userId: 'u1' }, { userId: 'u2' }] }) });
    expect(await provider().findUser('a@b.c')).toBeNull();
  });
  it('findUser maps the user when exactly 1 result', async () => {
    stubClient({
      listUsers: async () => ({ result: [{ userId: 'u1', preferredLoginName: 'a@b.c' }] }),
    });
    expect((await provider().findUser('a@b.c'))?.id).toBe('u1');
  });
  it('getAuthRequest throws ProviderError(NOT_FOUND) when authRequest is missing', async () => {
    stubClient({ getAuthRequest: async () => ({ authRequest: undefined }) });
    await expect(provider().getAuthRequest('oidc', 'x')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(provider().getAuthRequest('oidc', 'x')).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('ZitadelAuthProvider — isInstanceAdmin', () => {
  const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
  afterEach(() => vi.unstubAllGlobals());

  it('true when a membership has iam:true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okJson({
          result: [
            { roles: ['ORG_OWNER'], orgId: 'o' },
            { roles: ['IAM_OWNER'], iam: true },
          ],
        })
      )
    );
    expect(await provider().isInstanceAdmin({ id: 's', token: 't' })).toBe(true);
  });
  it('true when a role starts with IAM_ even without the iam flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson({ result: [{ roles: ['IAM_OWNER'] }] }))
    );
    expect(await provider().isInstanceAdmin({ id: 's', token: 't' })).toBe(true);
  });
  it('false for an org-owner only (no instance membership)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson({ result: [{ roles: ['ORG_OWNER'], orgId: 'o' }] }))
    );
    expect(await provider().isInstanceAdmin({ id: 's', token: 't' })).toBe(false);
  });
  it('false on empty result, non-2xx, or thrown error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson({}))
    );
    expect(await provider().isInstanceAdmin({ id: 's', token: 't' })).toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response)
    );
    expect(await provider().isInstanceAdmin({ id: 's', token: 't' })).toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('net');
      })
    );
    expect(await provider().isInstanceAdmin({ id: 's', token: 't' })).toBe(false);
  });
  it('calls the memberships endpoint with the session token as bearer', async () => {
    const f = vi.fn(async () => okJson({ result: [] }));
    vi.stubGlobal('fetch', f);
    await provider().isInstanceAdmin({ id: 's', token: 'sess-tok' });
    expect(f).toHaveBeenCalledWith(
      'https://z.test/auth/v1/memberships/me/_search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sess-tok' }),
      })
    );
  });
  it('isInstanceAdmin returns false when the membership fetch is aborted (timeout)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      })
    );
    const result = await provider().isInstanceAdmin({ id: 's1', token: 't1' });
    expect(result).toBe(false);
  });
});

describe('ZitadelAuthProvider — RPC deadline', () => {
  it('rejects a never-resolving RPC with a deadline error instead of hanging', async () => {
    stubClient({ getSession: () => new Promise(() => {}) });
    await expect(provider().getSession('s1', 't1')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  }, 15_000);
});

describe('ZitadelAuthProvider — createSession lifetime + opts', () => {
  type CapturedReq = {
    lifetime?: { seconds?: bigint };
    metadata?: Record<string, Uint8Array>;
    checks?: { user?: { search?: { case?: string; value?: string } } };
  };

  it('requests an explicit session lifetime and builds the user check from opts.userId', async () => {
    // Without a lifetime the created session has no expirationDate → mapper stores expiresAt='' →
    // listSessions drops every entry → the multi-account picker is always empty. createSession
    // must send a positive lifetime so sessions carry a real expiry.
    let captured: CapturedReq | undefined;
    stubClient({
      createSession: async (req: CapturedReq) => {
        captured = req;
        return { sessionId: 's1', sessionToken: 'tok' };
      },
      getSession: async () => ({ session: { id: 's1' } }),
    });
    await provider().createSession({ password: 'p' }, { userId: 'u1' });
    expect(captured?.lifetime).toBeDefined();
    expect(Number(captured?.lifetime?.seconds)).toBeGreaterThan(0);
    expect(captured?.checks?.user?.search?.value).toBe('u1');
  });

  it('forwards opts.metadata to the CreateSession proto metadata map, encoded string→bytes', async () => {
    let captured: CapturedReq | undefined;
    stubClient({
      createSession: async (req: CapturedReq) => {
        captured = req;
        return { sessionId: 's1', sessionToken: 'tok' };
      },
      getSession: async () => ({ session: { id: 's1' } }),
    });
    await provider().createSession(
      {},
      { userId: 'u1', metadata: { 'maxmind/tracking-token': 'tok-abc' } }
    );
    const bytes = captured?.metadata?.['maxmind/tracking-token'];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe('tok-abc');
  });

  it('omits the metadata field entirely when opts.metadata is absent', async () => {
    let captured: CapturedReq | undefined;
    stubClient({
      createSession: async (req: CapturedReq) => {
        captured = req;
        return { sessionId: 's1', sessionToken: 'tok' };
      },
      getSession: async () => ({ session: { id: 's1' } }),
    });
    await provider().createSession({}, { userId: 'u1' });
    expect(captured?.metadata).toBeUndefined();
  });

  // CreateSessionResponse omits the Session entity (only
  // {details,sessionId,sessionToken,challenges}), so exactly ONE getSession is required to
  // build the returned Session. Pin that there is no REDUNDANT second fetch on top of it.
  it('issues exactly one getSession after createSession (no redundant second fetch)', async () => {
    const createSession = vi.fn(async () => ({ sessionId: 's1', sessionToken: 'tok' }));
    const getSession = vi.fn(async () => ({ session: { id: 's1' } }));
    stubClient({ createSession, getSession });
    await provider().createSession({ password: 'p' }, { userId: 'u1' });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledTimes(1);
  });
});

describe('ZitadelAuthProvider — updateSession / deleteSession', () => {
  it('updateSession sends the checks and maps the refreshed session', async () => {
    const setSession = vi.fn(async () => ({ sessionToken: 'newtok' }));
    const getSession = vi.fn(async () => ({
      session: { id: 's1', factors: { user: { id: 'u1', loginName: 'a@b.c' } } },
    }));
    stubClient({ setSession, getSession });
    const out = await provider().updateSession('s1', 'tok', { password: 'pw' });
    expect(setSession).toHaveBeenCalledTimes(1);
    expect(out.id).toBe('s1');
    expect(out.token).toBe('newtok');
  });

  // SetSessionResponse omits the Session entity (only
  // {details,sessionToken,challenges}), so exactly ONE getSession is required to reflect the
  // just-applied factor. Pin that the set+refresh path issues no redundant second fetch.
  it('updateSession issues exactly one getSession after setSession (no redundant second fetch)', async () => {
    const setSession = vi.fn(async () => ({ sessionToken: 'newtok' }));
    const getSession = vi.fn(async () => ({
      session: { id: 's1', factors: { user: { id: 'u1', loginName: 'a@b.c' } } },
    }));
    stubClient({ setSession, getSession });
    await provider().updateSession('s1', 'tok', { password: 'pw' });
    expect(setSession).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('deleteSession calls the delete RPC with id + token', async () => {
    const deleteSession = vi.fn(async () => ({}));
    stubClient({ deleteSession });
    await provider().deleteSession('s1', 'tok');
    // The adapter forwards a second `{}` options arg — assert only the first (request) arg.
    expect(deleteSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', sessionToken: 'tok' }),
      expect.anything()
    );
  });
});

// Regression: Zitadel rejects an empty PasskeyName/TokenName with [invalid_argument]
// (surfaced to routes as the generic INVALID_CREDENTIALS — "enrollment failed"). The
// adapter must never send an empty name. The fake provider ignores the name, so this
// guard can only live at the Zitadel adapter layer.
describe('ZitadelAuthProvider — webauthn credential names', () => {
  it('verifyPasskey sends a non-empty default passkeyName', async () => {
    const verifyPasskeyRegistration = vi.fn(async () => ({}));
    stubClient({ verifyPasskeyRegistration });
    await provider().verifyPasskey('u1', 'pk1', { fake: true });
    expect(verifyPasskeyRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ passkeyName: 'Passkey' }),
      expect.anything()
    );
  });

  it('verifyPasskey forwards a route-supplied label', async () => {
    const verifyPasskeyRegistration = vi.fn(async () => ({}));
    stubClient({ verifyPasskeyRegistration });
    await provider().verifyPasskey('u1', 'pk1', { fake: true }, 'My Laptop');
    expect(verifyPasskeyRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ passkeyName: 'My Laptop' }),
      expect.anything()
    );
  });

  it('verifyU2F defaults tokenName when the route passes an empty string', async () => {
    const verifyU2FRegistration = vi.fn(async () => ({}));
    stubClient({ verifyU2FRegistration });
    await provider().verifyU2F('u1', { u2fId: 'k1', publicKeyCredential: {}, tokenName: '' });
    expect(verifyU2FRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ tokenName: 'Security key' }),
      expect.anything()
    );
  });
});
