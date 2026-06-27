// cypress/component/modules/i18n/locales.cy.ts
//
// Component (no-mount) port of app/modules/i18n/__tests__/locales.test.ts.
// Pure constant assertion (browser-safe).
import { SUPPORTED_LOCALES } from '@/modules/i18n/lingui';

describe('SUPPORTED_LOCALES', () => {
  it('only English is a supported locale (es removed)', () => {
    expect(SUPPORTED_LOCALES).to.deep.equal(['en']);
  });
});
