import { assertHttpUrl } from '../saml-post';
import { describe, it, expect } from 'vitest';

describe('assertHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(() => assertHttpUrl('https://sp.example/acs')).not.toThrow();
    expect(() => assertHttpUrl('http://sp.example/acs')).not.toThrow();
  });
  it('rejects javascript: and other non-http schemes', () => {
    expect(() => assertHttpUrl('javascript:alert(1)')).toThrow();
    expect(() => assertHttpUrl('data:text/html,x')).toThrow();
    expect(() => assertHttpUrl('not a url')).toThrow();
  });
});
