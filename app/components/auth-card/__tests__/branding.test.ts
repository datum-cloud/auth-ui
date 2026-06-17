import { brandingToStyle } from '@/components/auth-card/branding';
import { describe, it, expect } from 'vitest';

describe('brandingToStyle', () => {
  it('maps primaryColor → --primary and backgroundColor → --background', () => {
    expect(brandingToStyle({ primaryColor: '#5469d4' })).toEqual({ '--primary': '#5469d4' });
    expect(brandingToStyle({ backgroundColor: '#ffffff' })).toEqual({ '--background': '#ffffff' });
    expect(brandingToStyle({ primaryColor: '#111', backgroundColor: '#222' })).toEqual({
      '--primary': '#111',
      '--background': '#222',
    });
  });

  it('returns an empty object (datum defaults) when branding or the field is absent', () => {
    expect(brandingToStyle(undefined)).toEqual({});
    expect(brandingToStyle(null)).toEqual({});
    expect(brandingToStyle({})).toEqual({});
    // logoUrl is rendered separately, not as a CSS var.
    expect(brandingToStyle({ logoUrl: 'https://cdn.example/logo.svg' })).toEqual({});
  });
});
