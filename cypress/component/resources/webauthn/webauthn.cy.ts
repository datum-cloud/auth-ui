// cypress/component/resources/webauthn/webauthn.cy.ts
//
// Component (no-mount) port of app/resources/webauthn/__tests__/webauthn.test.ts.
// The base64url codec + ceremony error handling are browser-side concerns (atob/btoa,
// navigator.credentials, DOMException) — they belong in the real browser, which Cypress
// provides. KEPT + EXTENDED: the ceremony now classifies the DOMException that
// navigator.credentials.create/get THROWS on a real failure (no authenticator, cancel,
// already-registered) into a stable reason, instead of only handling the rare null return.
import {
  base64UrlToBuffer,
  bufferToBase64Url,
  classifyWebAuthnError,
  createAttestation,
  marshalAssertion,
  WebAuthnCeremonyError,
  type WebAuthnReason,
} from '@/resources/webauthn/webauthn';

describe('webauthn base64url codec', () => {
  it('round-trips bytes, decodes known strings, and returns a real ArrayBuffer', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const b64 = bufferToBase64Url(bytes.buffer);
    expect(b64).to.not.match(/[+/=]/); // URL-safe, unpadded
    expect(new Uint8Array(base64UrlToBuffer(b64))).to.deep.equal(bytes);
    expect(bufferToBase64Url(base64UrlToBuffer(''))).to.equal('');
    expect(new Uint8Array(base64UrlToBuffer('AQID'))).to.deep.equal(new Uint8Array([1, 2, 3]));
    expect(base64UrlToBuffer('AQID')).to.be.instanceOf(ArrayBuffer);
  });
});

// classifyWebAuthnError is the pure regression guard: the WebAuthn spec surfaces every real
// failure as a DOMException whose `.name` disambiguates the cause. This mapping is the single
// source of truth the ceremony wrappers + the button copy both rely on.
describe('classifyWebAuthnError', () => {
  const cases: Array<[string, WebAuthnReason]> = [
    ['NotAllowedError', 'not-allowed'],
    ['AbortError', 'not-allowed'],
    ['TimeoutError', 'not-allowed'],
    ['InvalidStateError', 'already-registered'],
    ['NotSupportedError', 'unsupported'],
    ['ConstraintError', 'unsupported'],
    ['SecurityError', 'security'],
    ['NetworkError', 'unknown'], // a DOMException whose name is not mapped
  ];
  it('maps every spec DOMException name to its stable reason, and every non-DOMException value → "unknown"', () => {
    for (const [name, reason] of cases) {
      expect(classifyWebAuthnError(new DOMException('boom', name)), name).to.equal(reason);
    }

    // Nothing that merely LOOKS like a DOMException may be classified — a plain object
    // carrying a spoofed WebAuthn name is still not a DOMException.
    for (const [label, value] of [
      ['plain Error', new Error('nope')],
      ['spoofed name object', { name: 'NotAllowedError' }],
      ['bare string', 'NotAllowedError'],
      ['null', null],
      ['undefined', undefined],
    ] as const) {
      expect(classifyWebAuthnError(value), label).to.equal('unknown');
    }
  });
});

const PK_GET = { challenge: 'YQ', allowCredentials: [] };
const PK_CREATE = { challenge: 'YQ', user: { id: 'YQ' }, excludeCredentials: [] };

// Ensure isWebAuthnSupported() passes (needs window.PublicKeyCredential) and a
// navigator.credentials object exists to stub. Chromium/Electron provides both; define
// stand-ins only if a headless context lacks them.
function ensureWebAuthnEnv(): void {
  const w = window as unknown as { PublicKeyCredential?: unknown };
  if (typeof w.PublicKeyCredential === 'undefined') {
    w.PublicKeyCredential = function () {} as unknown;
  }
  if (!window.navigator.credentials) {
    Object.defineProperty(window.navigator, 'credentials', {
      value: { create: () => Promise.resolve(null), get: () => Promise.resolve(null) },
      configurable: true,
    });
  }
}

/**
 * Re-stub navigator.credentials for the next row. cy.stub auto-restores BETWEEN tests, not
 * within one — so a table that stubs the same method twice in a single `it` throws
 * "Attempted to wrap create which is already wrapped" without this explicit restore.
 */
function stubCredential(method: 'get' | 'create', failure: DOMException | null): void {
  ensureWebAuthnEnv();
  const creds = window.navigator.credentials as unknown as Record<string, { restore?: () => void }>;
  creds[method]?.restore?.();
  const stub = cy.stub(window.navigator.credentials, method);
  if (failure) stub.rejects(failure);
  else stub.resolves(null); // null credential === user cancel
}

// Both ceremonies, both failure modes: a null return (user-cancel) and a thrown DOMException.
const CEREMONIES: Array<{
  label: string;
  method: 'get' | 'create';
  failure: DOMException | null;
  run: () => Promise<unknown>;
  reason: WebAuthnReason;
}> = [
  {
    label: 'marshalAssertion (sign-in) null credential',
    method: 'get',
    failure: null,
    run: () => marshalAssertion(PK_GET),
    reason: 'not-allowed',
  },
  {
    label: 'marshalAssertion (sign-in) NotAllowedError',
    method: 'get',
    failure: new DOMException('no authenticator', 'NotAllowedError'),
    run: () => marshalAssertion(PK_GET),
    reason: 'not-allowed',
  },
  {
    label: 'createAttestation (enroll) InvalidStateError',
    method: 'create',
    failure: new DOMException('excluded credential present', 'InvalidStateError'),
    run: () => createAttestation(PK_CREATE),
    reason: 'already-registered',
  },
  {
    label: 'createAttestation (enroll) null credential',
    method: 'create',
    failure: null,
    run: () => createAttestation(PK_CREATE),
    reason: 'not-allowed',
  },
];

describe('marshalAssertion / createAttestation ceremony error handling', () => {
  it('rejects with a classified WebAuthnCeremonyError on a null credential and a thrown DOMException', async () => {
    for (const { label, method, failure, run, reason } of CEREMONIES) {
      stubCredential(method, failure);

      let thrown: unknown = null;
      try {
        await run();
      } catch (err) {
        thrown = err;
      }
      expect(thrown, `${label}: rejected with a WebAuthnCeremonyError`).to.be.instanceOf(
        WebAuthnCeremonyError
      );
      expect((thrown as WebAuthnCeremonyError).reason, `${label}: reason`).to.equal(reason);
    }
  });
});
