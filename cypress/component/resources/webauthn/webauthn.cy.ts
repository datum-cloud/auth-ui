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
  for (const [name, reason] of cases) {
    it(`maps DOMException "${name}" → "${reason}"`, () => {
      expect(classifyWebAuthnError(new DOMException('boom', name))).to.equal(reason);
    });
  }

  it('maps a plain Error and other non-DOMException values → "unknown"', () => {
    expect(classifyWebAuthnError(new Error('nope'))).to.equal('unknown');
    // A plain object carrying a spoofed WebAuthn name is still not a DOMException.
    expect(classifyWebAuthnError({ name: 'NotAllowedError' })).to.equal('unknown');
    expect(classifyWebAuthnError('NotAllowedError')).to.equal('unknown');
    expect(classifyWebAuthnError(null)).to.equal('unknown');
    expect(classifyWebAuthnError(undefined)).to.equal('unknown');
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

describe('marshalAssertion (sign-in) ceremony error handling', () => {
  it('maps a null credential (user-cancel) to WebAuthnCeremonyError reason "not-allowed"', () => {
    ensureWebAuthnEnv();
    cy.stub(window.navigator.credentials, 'get').resolves(null);
    return marshalAssertion(PK_GET).then(
      () => {
        throw new Error('expected a WebAuthnCeremonyError');
      },
      (err: unknown) => {
        expect(err).to.be.instanceOf(WebAuthnCeremonyError);
        expect((err as WebAuthnCeremonyError).reason).to.equal('not-allowed');
      }
    );
  });

  it('classifies a thrown DOMException (NotAllowedError → "not-allowed")', () => {
    ensureWebAuthnEnv();
    cy.stub(window.navigator.credentials, 'get').rejects(
      new DOMException('no authenticator', 'NotAllowedError')
    );
    return marshalAssertion(PK_GET).then(
      () => {
        throw new Error('expected a WebAuthnCeremonyError');
      },
      (err: unknown) => {
        expect(err).to.be.instanceOf(WebAuthnCeremonyError);
        expect((err as WebAuthnCeremonyError).reason).to.equal('not-allowed');
      }
    );
  });
});

describe('createAttestation (enroll) ceremony error handling', () => {
  it('classifies a thrown DOMException (InvalidStateError → "already-registered")', () => {
    ensureWebAuthnEnv();
    cy.stub(window.navigator.credentials, 'create').rejects(
      new DOMException('excluded credential present', 'InvalidStateError')
    );
    return createAttestation(PK_CREATE).then(
      () => {
        throw new Error('expected a WebAuthnCeremonyError');
      },
      (err: unknown) => {
        expect(err).to.be.instanceOf(WebAuthnCeremonyError);
        expect((err as WebAuthnCeremonyError).reason).to.equal('already-registered');
      }
    );
  });

  it('maps a null credential (user-cancel) to WebAuthnCeremonyError reason "not-allowed"', () => {
    ensureWebAuthnEnv();
    cy.stub(window.navigator.credentials, 'create').resolves(null);
    return createAttestation(PK_CREATE).then(
      () => {
        throw new Error('expected a WebAuthnCeremonyError');
      },
      (err: unknown) => {
        expect(err).to.be.instanceOf(WebAuthnCeremonyError);
        expect((err as WebAuthnCeremonyError).reason).to.equal('not-allowed');
      }
    );
  });
});
