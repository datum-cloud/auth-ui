// cypress/component/modules/auth/providers/zitadel/verify.adapter.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/verify.adapter.test.ts.
// Pure normalizeError mapping — browser-side Chai only.
import { normalizeError } from '@/modules/auth/providers/zitadel/mappers';
import { ProviderError } from '@/modules/auth/types';

// minimal ConnectError shape
const ce = (code: number, message = 'boom') => ({ code, message, findDetails: () => [] });

describe('normalizeError — verification error codes', () => {
  it('code 9 + "already verified" → ALREADY_DONE', () => {
    const e = normalizeError(ce(9, 'email already verified'));
    expect(e).to.be.instanceOf(ProviderError);
    expect(e.code).to.equal('ALREADY_DONE');
  });

  it('code 9 + "already done" → ALREADY_DONE', () => {
    const e = normalizeError(ce(9, 'operation already done'));
    expect(e.code).to.equal('ALREADY_DONE');
  });

  it('code 9 + unrelated message → FAILED_PRECONDITION', () => {
    // FailedPrecondition without verified/already in the message maps to FAILED_PRECONDITION,
    // not UNKNOWN. This assertion confirms the mapper behaviour.
    const e = normalizeError(ce(9, 'precondition failed'));
    expect(e.code).to.equal('FAILED_PRECONDITION');
  });
});
