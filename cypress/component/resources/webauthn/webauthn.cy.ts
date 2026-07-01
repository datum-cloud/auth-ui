// cypress/component/resources/webauthn/webauthn.cy.ts
//
// Component (no-mount) port of app/resources/webauthn/__tests__/webauthn.test.ts.
// The base64url codec + marshalAssertion cancel handling are browser-side concerns (atob/btoa,
// navigator.credentials) — they belong in the real browser, which Cypress provides. KEPT: the
// cancel→named-error mapping is the assertion-ceremony UX guard (no opaque TypeError on a null
// credential).
import {
  base64UrlToBuffer,
  bufferToBase64Url,
  marshalAssertion,
  WebAuthnCeremonyCancelledError,
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

const PK = { challenge: 'YQ', allowCredentials: [] };

describe('marshalAssertion cancel handling', () => {
  it('throws a clear cancellation error when credentials.get resolves null', () => {
    // isWebAuthnSupported() needs window.PublicKeyCredential defined (Chromium/Electron provides it;
    // define a stand-in only if a headless context lacks it).
    const w = window as unknown as { PublicKeyCredential?: unknown };
    if (typeof w.PublicKeyCredential === 'undefined') {
      w.PublicKeyCredential = function () {} as unknown;
    }
    // navigator.credentials.get resolving null is the user-cancel signal the SUT must map to a
    // NAMED error (instead of an opaque TypeError on the null deref).
    if (!window.navigator.credentials) {
      Object.defineProperty(window.navigator, 'credentials', {
        value: { get: () => Promise.resolve(null) },
        configurable: true,
      });
    } else {
      cy.stub(window.navigator.credentials, 'get').resolves(null);
    }

    return marshalAssertion(PK).then(
      () => {
        throw new Error('expected a WebAuthnCeremonyCancelledError');
      },
      (err: unknown) => {
        expect(err).to.be.instanceOf(WebAuthnCeremonyCancelledError);
      }
    );
  });
});
