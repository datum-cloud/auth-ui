// cypress/component/resources/login/login-schema.cy.ts
//
// Component (no-mount) port of app/resources/login/__tests__/login-schema.test.ts.
// Pure Zod schema utilities → browser-side Chai only.
import { isEmailLike, isPhoneLike } from '@/resources/login/login.schema';

describe('isPhoneLike / isEmailLike', () => {
  it('classifies phone-shaped and email-shaped identifiers', () => {
    for (const phone of ['+15550000000', '0612345678', '+1 555 000 0000']) {
      expect(isPhoneLike(phone), `isPhoneLike(${phone})`).to.equal(true);
    }

    for (const email of [
      'a@b.com',
      'alice@acme.test',
      'alice@acme.zitadel.cloud',
      '  alice@acme.test  ',
    ]) {
      expect(isEmailLike(email), `isEmailLike(${JSON.stringify(email)})`).to.equal(true);
    }
  });
});
