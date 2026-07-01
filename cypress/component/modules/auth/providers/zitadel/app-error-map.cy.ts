// cypress/component/modules/auth/providers/zitadel/app-error-map.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/app-error-map.test.ts.
// Pure provider→AppError mapping — browser-side Chai only.
//
// Final squeeze: merged into a single test. Kept: the raw-error-text non-leak guard
// (information-disclosure protection) and the unknown-code fail-safe default; the remaining
// provider-code → status-code table entries are a straightforward enum lookup, reduced to one
// representative mapping.
import { toAppError } from '@/modules/auth/providers/zitadel/app-error-map';
import { ProviderError } from '@/modules/auth/types';

describe('toAppError — strict neutral provider→AppError mapping', () => {
  it('maps a known provider code to its status (representative), degrades unknown/non-ProviderError inputs to UNEXPECTED/500, and never leaks raw error text', () => {
    const known = toAppError(new ProviderError('INVALID_CREDENTIALS', 'raw zitadel detail'));
    expect(known.code).to.equal('INVALID_CREDENTIALS');
    expect(known.status).to.equal(401);

    const unknown = toAppError(new ProviderError('SOME_NEW_CODE' as never, 'x'));
    expect(unknown.code).to.equal('UNEXPECTED');
    expect(unknown.status).to.equal(500);

    const e = toAppError(new Error('postgres exploded at 10.0.0.4'));
    expect(e.code).to.equal('UNEXPECTED');
    expect(JSON.stringify(e)).not.to.include('postgres');
  });
});
