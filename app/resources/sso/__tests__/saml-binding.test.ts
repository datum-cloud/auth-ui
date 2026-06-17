import { resolveSamlBinding } from '../saml-binding';
import type { SamlResponse } from '@/modules/auth/types';
import { describe, it, expect } from 'vitest';

describe('resolveSamlBinding', () => {
  it('redirect binding yields a redirect result', () => {
    const r: SamlResponse = { url: 'https://sp.test/acs?SAMLResponse=abc', binding: 'redirect' };
    expect(resolveSamlBinding(r)).toEqual({ kind: 'redirect', url: r.url });
  });
  it('post binding yields the form fields', () => {
    const r: SamlResponse = {
      url: 'https://sp.test/acs',
      binding: 'post',
      relayState: 'rs',
      samlResponse: 'b64',
    };
    expect(resolveSamlBinding(r)).toEqual({
      kind: 'post',
      url: 'https://sp.test/acs',
      fields: { RelayState: 'rs', SAMLResponse: 'b64' },
    });
  });
  it('post binding missing fields throws', () => {
    const r: SamlResponse = { url: 'https://sp.test/acs', binding: 'post' };
    expect(() => resolveSamlBinding(r)).toThrow(/missing SAML POST fields/i);
  });
  it('post binding with only relayState missing throws', () => {
    const r: SamlResponse = { url: 'https://sp.test/acs', binding: 'post', samlResponse: 'b64' };
    expect(() => resolveSamlBinding(r)).toThrow(/missing SAML POST fields/i);
  });
  it('post binding with only samlResponse missing throws', () => {
    const r: SamlResponse = { url: 'https://sp.test/acs', binding: 'post', relayState: 'rs' };
    expect(() => resolveSamlBinding(r)).toThrow(/missing SAML POST fields/i);
  });
  it('unknown binding from the transport throws', () => {
    const r = { url: 'https://sp.test/acs', binding: 'artifact' } as unknown as SamlResponse;
    expect(() => resolveSamlBinding(r)).toThrow(/unsupported SAML binding/i);
  });
});
