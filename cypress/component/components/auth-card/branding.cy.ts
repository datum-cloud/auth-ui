import { brandingToStyle } from '@/components/auth-card/branding';

describe('brandingToStyle', () => {
  it('maps primaryColor/backgroundColor to CSS vars, and returns an empty object (datum defaults) when branding or the field is absent', () => {
    expect(brandingToStyle({ primaryColor: '#5469d4' })).to.deep.equal({ '--primary': '#5469d4' });
    expect(brandingToStyle({ backgroundColor: '#ffffff' })).to.deep.equal({
      '--background': '#ffffff',
    });
    expect(brandingToStyle({ primaryColor: '#111', backgroundColor: '#222' })).to.deep.equal({
      '--primary': '#111',
      '--background': '#222',
    });

    expect(brandingToStyle(undefined)).to.deep.equal({});
    expect(brandingToStyle(null)).to.deep.equal({});
    expect(brandingToStyle({})).to.deep.equal({});
    // logoUrl is rendered separately, not as a CSS var.
    expect(brandingToStyle({ logoUrl: 'https://cdn.example/logo.svg' })).to.deep.equal({});
  });
});
