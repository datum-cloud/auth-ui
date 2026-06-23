import { assetUrl } from '../asset-url';
import { describe, it, expect } from 'vitest';

describe('assetUrl', () => {
  const base = import.meta.env.BASE_URL;
  it('prefixes a leading-slash path with the Vite base', () => {
    expect(assetUrl('/images/idps/google.png')).toBe(`${base}images/idps/google.png`);
  });
  it('prefixes a path with no leading slash', () => {
    expect(assetUrl('favicons/light/favicon.ico')).toBe(`${base}favicons/light/favicon.ico`);
  });
  it('does not double the slash after the base', () => {
    expect(assetUrl('/x.png').startsWith(`${base}/`)).toBe(false);
  });
});
