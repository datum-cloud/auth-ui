import {
  base64UrlToBuffer,
  bufferToBase64Url,
  getAssertion,
  WebAuthnCeremonyCancelledError,
} from './webauthn';
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('webauthn base64url codec', () => {
  it('round-trips bytes through base64url', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const b64 = bufferToBase64Url(bytes.buffer);
    expect(b64).not.toMatch(/[+/=]/); // URL-safe, unpadded
    expect(new Uint8Array(base64UrlToBuffer(b64))).toEqual(bytes);
    expect(bufferToBase64Url(base64UrlToBuffer(''))).toBe('');
  });
  it('decodes a known base64url string', () => {
    expect(new Uint8Array(base64UrlToBuffer('AQID'))).toEqual(new Uint8Array([1, 2, 3]));
  });
  it('returns an ArrayBuffer (not a node Buffer)', () => {
    expect(base64UrlToBuffer('AQID')).toBeInstanceOf(ArrayBuffer);
  });
});

afterEach(() => vi.unstubAllGlobals());

const PK = { challenge: 'YQ', allowCredentials: [] };

describe('getAssertion cancel handling (CODE-MIN-08)', () => {
  it('throws a clear cancellation error when credentials.get resolves null', async () => {
    vi.stubGlobal('window', { PublicKeyCredential: function () {} });
    vi.stubGlobal('navigator', { credentials: { get: () => Promise.resolve(null) } });
    await expect(getAssertion(PK)).rejects.toBeInstanceOf(WebAuthnCeremonyCancelledError);
  });
});
