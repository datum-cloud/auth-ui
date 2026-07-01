// cypress/component/modules/auth/providers/zitadel/verify.adapter.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/verify.adapter.test.ts.
// Pure normalizeError mapping — browser-side Chai only.
//
// code 9 + already/verified → ALREADY_DONE is exercised (with an explicit regression-guard
// comment) in mappers.cy.ts; kept here is the complementary branch — an unrelated code-9
// message must NOT be swept into ALREADY_DONE.
import { normalizeError } from '@/modules/auth/providers/zitadel/mappers';
import { ProviderError } from '@/modules/auth/types';

// minimal ConnectError shape
const ce = (code: number, message = 'boom') => ({ code, message, findDetails: () => [] });

describe('normalizeError — verification error codes', () => {
  it('code 9 + unrelated message → FAILED_PRECONDITION, not ALREADY_DONE/UNKNOWN', () => {
    const e = normalizeError(ce(9, 'precondition failed'));
    expect(e).to.be.instanceOf(ProviderError);
    expect(e.code).to.equal('FAILED_PRECONDITION');
  });
});
