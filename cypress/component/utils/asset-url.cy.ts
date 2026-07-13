// cypress/component/utils/asset-url.cy.ts
// COMPONENT port of app/utils/__tests__/asset-url.test.ts
// Pure URL prefixer: strips leading slash, prepends import.meta.env.BASE_URL.
import { assetUrl } from '@/utils/asset-url';

describe('assetUrl', () => {
  const base = import.meta.env.BASE_URL;

  it('prefixes a path (with or without a leading slash) with the Vite base, without doubling the slash', () => {
    expect(assetUrl('/images/idps/google.png')).to.equal(`${base}images/idps/google.png`);
    expect(assetUrl('favicons/light/favicon.ico')).to.equal(`${base}favicons/light/favicon.ico`);
    expect(assetUrl('/x.png').startsWith(`${base}/`)).to.equal(false);
  });
});
