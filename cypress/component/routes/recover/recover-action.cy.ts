// cypress/component/routes/recover/recover-action.cy.ts
//
// CY-TASK: the /recover loader+action read signed cookies off a real Request, seal real tickets
// and emit real audit — all node-bound.
//
// THE G7 MATRIX IS THE POINT OF THIS FILE. Six account states go through the request intent and
// every one of them must produce the same observable response AND a Set-Cookie of the same
// length. A difference in either is an enumeration oracle: it tells an attacker which addresses
// have accounts. The length comparison is separate from the body comparison on purpose — the
// bodies were always equal; it was the ticket that could diverge.
import { callService } from '../../../support/node/call-service';
import type { Verdict } from '../../../support/node/scenario';

const ENV = {
  AUTH_ACCOUNT_RECOVERY_ENABLED: 'true',
  VERIFICATION_MAIL_URL: 'http://127.0.0.1:58790/v1/email/verification',
  RECOVERY_MAIL_URL: 'http://127.0.0.1:58790/v1/email/recovery',
  PUBLIC_ORIGIN: 'http://localhost',
};

const EMAIL = 'owner@acme.test';

function observable(v: Verdict) {
  return {
    isResponse: v.response?.isResponse ?? null,
    status: v.response?.status ?? null,
    location: v.response?.location ?? null,
    dataStatus: v.response?.dataStatus ?? null,
    dataBody: v.response?.dataBody ?? null,
  };
}

// A Response carries setCookies; a data() envelope carries dataSetCookies. The request intent
// returns the latter, so both are read here rather than assuming one shape.
const allSetCookies = (v: Verdict) => [
  ...(v.response?.setCookies ?? []),
  ...(v.response?.dataSetCookies ?? []),
];
const cookieLengths = (v: Verdict) => allSetCookies(v).map((c) => c.length);

function request(seed: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return callService({
    fn: 'recoverAction',
    seed,
    env: ENV,
    request: {
      url: 'http://localhost/id/recover',
      csrf: true,
      form: { intent: 'request', email: EMAIL, ...(extra.form as object) },
    },
    ...extra,
  });
}

// The six states from the spec's G7 row, each with a different side effect.
const STATES: Array<
  [name: string, seed: Record<string, unknown>, extra?: Record<string, unknown>]
> = [
  [
    'a verified account with a passkey',
    {
      users: [{ id: 'u-1', loginName: EMAIL, orgId: 'org-1' }],
      authMethods: { 'u-1': ['passkey'] },
    },
  ],
  ['an address with no account at all', { users: [] }],
  [
    'an unverified signup (class d)',
    { users: [{ id: 'u-1', loginName: EMAIL, orgId: 'org-1' }], authMethods: { 'u-1': [] } },
  ],
  [
    'an org that forbids passkeys',
    {
      users: [{ id: 'u-1', loginName: EMAIL, orgId: 'org-1' }],
      authMethods: { 'u-1': ['passkey'] },
      settingsByOrg: { 'org-1': { passkeysType: 'not_allowed' } },
    },
  ],
  [
    'a rate-limited address',
    {
      users: [{ id: 'u-1', loginName: EMAIL, orgId: 'org-1' }],
      authMethods: { 'u-1': ['passkey'] },
    },
    { recoverActionTwice: true },
  ],
  [
    'a request the bot gate rejected',
    {
      users: [{ id: 'u-1', loginName: EMAIL, orgId: 'org-1' }],
      authMethods: { 'u-1': ['passkey'] },
    },
    { recaptchaFetch: { body: { success: false } }, env: { ...ENV, RECAPTCHA_SECRET_KEY: 's' } },
  ],
];

describe('/recover action — G7: every request exit is indistinguishable', () => {
  it('returns the same response and the same Set-Cookie length for all six states', () => {
    const seen: Array<{ name: string; obs: ReturnType<typeof observable>; lens: number[] }> = [];

    for (const [name, seed, extra] of STATES) {
      request(seed, extra ?? {}).then((v) => {
        seen.push({ name, obs: observable(v), lens: cookieLengths(v) });
      });
    }

    cy.then(() => {
      const first = seen[0];
      expect(first.lens.length, 'every exit must set exactly one ticket cookie').to.equal(1);
      for (const row of seen.slice(1)) {
        expect(row.obs, `${row.name} must be indistinguishable from ${first.name}`).to.deep.equal(
          first.obs
        );
        expect(
          row.lens,
          `${row.name}: the ticket length is the enumeration channel — it must not vary`
        ).to.deep.equal(first.lens);
      }
      // Positive half: the shared shape must be the real terminal, not a shared failure.
      expect(first.obs.dataStatus).to.equal(200);
      expect(first.obs.dataBody).to.deep.equal({ sent: true, email: EMAIL });
    });
  });

  it('ignores a userId the client tries to post', () => {
    request(
      {
        users: [{ id: 'u-1', loginName: EMAIL, orgId: 'org-1' }],
        authMethods: { 'u-1': ['passkey'] },
      },
      { form: { userId: 'u-SOMEONE-ELSE' } }
    ).then((v) => {
      // The schema has no userId field, so it is stripped — the account acted on is the one the
      // address resolves to, and the audit proves which that was.
      expect(v.response?.dataStatus).to.equal(200);
      expect((v.auditLines ?? []).join('\n')).to.contain('"userId":"u-1"');
    });
  });
});

describe('/recover action — the typed-code path', () => {
  const seed = {
    users: [{ id: 'u-1', loginName: EMAIL, orgId: 'org-1' }],
    authMethods: { 'u-1': ['passkey'] },
  };

  it('opens the ceremony for a valid ticket + code, and sets a ceremony cookie', () => {
    callService({
      fn: 'recoverCodeAction',
      seed,
      env: ENV,
      mintPasskeyCode: 'u-1',
      request: {
        url: 'http://localhost/id/recover',
        csrf: true,
        recoveryTicket: { userId: 'u-1', codeId: 'MINTED', email: EMAIL },
        form: { intent: 'code', email: EMAIL, code: 'MINTED' },
      },
    }).then((v) => {
      expect(v.response?.dataStatus).to.equal(200);
      expect((v.response?.dataBody as Record<string, unknown>).ceremony).to.equal(true);
      expect(allSetCookies(v).join('\n')).to.contain('recovery_ceremony=');
    });
  });

  it('trims a whitespace-padded code — mail clients add spaces', () => {
    callService({
      fn: 'recoverCodeAction',
      seed,
      env: ENV,
      mintPasskeyCode: 'u-1',
      request: {
        url: 'http://localhost/id/recover',
        csrf: true,
        recoveryTicket: { userId: 'u-1', codeId: 'MINTED', email: EMAIL },
        form: { intent: 'code', email: EMAIL, code: '  MINTED  ' },
      },
    }).then((v) => {
      expect((v.response?.dataBody as Record<string, unknown>).ceremony).to.equal(true);
    });
  });

  const badRows: Array<[string, Record<string, unknown>]> = [
    ['a wrong code', { ticket: { userId: 'u-1', codeId: 'MINTED', email: EMAIL }, code: 'WRONG' }],
    [
      'a ticket issued for another address',
      { ticket: { userId: 'u-1', codeId: 'MINTED', email: 'other@acme.test' }, code: 'MINTED' },
    ],
    ['a filler ticket', { ticket: 'filler', code: 'MINTED' }],
    ['no ticket at all', { ticket: undefined, code: 'MINTED' }],
  ];

  it('gives ONE identical answer to every failure, with no ceremony cookie', () => {
    const seen: Array<{ name: string; obs: unknown; cookies: number }> = [];
    for (const [name, row] of badRows) {
      callService({
        fn: 'recoverCodeAction',
        seed,
        env: ENV,
        mintPasskeyCode: 'u-1',
        request: {
          url: 'http://localhost/id/recover',
          csrf: true,
          recoveryTicket: row.ticket as never,
          form: { intent: 'code', email: EMAIL, code: row.code as string },
        },
      }).then((v) => {
        seen.push({
          name,
          obs: observable(v),
          cookies: allSetCookies(v).length,
        });
      });
    }
    cy.then(() => {
      for (const row of seen) {
        expect(row.obs, `${row.name} must look like every other failure`).to.deep.equal(
          seen[0].obs
        );
        expect(row.cookies, `${row.name} must set no cookie`).to.equal(0);
      }
      expect((seen[0].obs as { dataStatus: number }).dataStatus).to.equal(400);
      expect((seen[0].obs as { dataBody: unknown }).dataBody).to.deep.equal({
        sent: true,
        email: EMAIL,
        error: 'INVALID_CODE',
      });
    });
  });
});

describe('/recover — the flag is the kill switch', () => {
  const off = { ...ENV, AUTH_ACCOUNT_RECOVERY_ENABLED: 'false' };

  it('404s from the loader while the flag is off', () => {
    callService({
      fn: 'recoverLoader',
      env: off,
      request: { url: 'http://localhost/id/recover' },
    }).then((v) => {
      expect(v.response?.status ?? v.response?.dataStatus).to.equal(404);
    });
  });

  it('404s from the action while the flag is off', () => {
    callService({
      fn: 'recoverAction',
      env: off,
      request: {
        url: 'http://localhost/id/recover',
        csrf: true,
        form: { intent: 'request', email: EMAIL },
      },
    }).then((v) => {
      expect(v.response?.status ?? v.response?.dataStatus).to.equal(404);
    });
  });

  it('404s /recover/complete from both verbs while the flag is off', () => {
    callService({
      fn: 'recoverCompleteLoader',
      env: off,
      request: { url: 'http://localhost/id/recover/complete' },
    }).then((v) => {
      expect(v.response?.status ?? v.response?.dataStatus).to.equal(404);
    });
    callService({
      fn: 'recoverCompleteAction',
      env: off,
      request: {
        url: 'http://localhost/id/recover/complete',
        csrf: true,
        form: { intent: 'start' },
      },
    }).then((v) => {
      expect(v.response?.status ?? v.response?.dataStatus).to.equal(404);
    });
  });
});

describe('/recover/complete — the mailed link', () => {
  const seed = {
    users: [{ id: 'u-1', loginName: EMAIL, orgId: 'org-1' }],
    authMethods: { 'u-1': ['passkey'] },
  };

  it('makes NO provider call on the loader — a prefetch must not burn the code', () => {
    callService({
      fn: 'recoverCompleteLoader',
      seed,
      env: ENV,
      mintPasskeyCode: 'u-1',
      recordCalls: ['registerPasskey'],
      request: { url: 'http://localhost/id/recover/complete?userId=u-1&codeId=c1&code=abc' },
    }).then((v) => {
      expect(v.calls?.registerPasskey ?? [], 'the loader must consume nothing').to.have.length(0);
      const body = v.response?.dataBody as Record<string, string>;
      expect(body.userId).to.equal('u-1');
      expect(body.code).to.equal('abc');
    });
  });

  it('answers RECOVERY_EXPIRED when the code was already consumed', () => {
    callService({
      fn: 'recoverCompleteAction',
      seed,
      env: ENV,
      mintPasskeyCode: 'u-1',
      consumeMintedCode: true,
      request: {
        url: 'http://localhost/id/recover/complete',
        csrf: true,
        form: { intent: 'start', userId: 'u-1', codeId: 'MINTED', code: 'MINTED' },
      },
    }).then((v) => {
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.deep.equal({ error: 'RECOVERY_EXPIRED' });
    });
  });

  it('redirects a successful verify to /login with the identifier, requestId and notice', () => {
    callService({
      fn: 'recoverCompleteAction',
      seed,
      env: ENV,
      request: {
        url: 'http://localhost/id/recover/complete',
        csrf: true,
        ceremonyTicket: { userId: 'u-1', passkeyId: 'pk-9' },
        form: {
          intent: 'verify',
          credential: '{"id":"cred-1"}',
          passkeyId: 'pk-9',
          passkeyName: 'Phone',
          requestId: 'req-3',
        },
      },
    }).then((v) => {
      const location = v.response?.location ?? '';
      expect(location).to.contain('/login');
      expect(location).to.contain(`loginName=${encodeURIComponent(EMAIL)}`);
      expect(location).to.contain('requestId=req-3');
      expect(location).to.contain('notice=passkey-recovered');
      // Both tickets are spent — a back-button replay must not re-post a dead ceremony.
      const cookies = allSetCookies(v).join('\n');
      expect(cookies).to.contain('recovery_ticket=');
      expect(cookies).to.contain('recovery_ceremony=');
      expect(cookies.match(/Max-Age=0/g) ?? []).to.have.length(2);
    });
  });
});
