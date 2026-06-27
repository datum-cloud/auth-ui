// cypress/component/modules/auth/providers/zitadel/app-error-map.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/app-error-map.test.ts.
// Pure provider→AppError mapping — browser-side Chai only.
import { toAppError } from '@/modules/auth/providers/zitadel/app-error-map';
import { ProviderError } from '@/modules/auth/types';

describe('toAppError — strict neutral provider→AppError mapping', () => {
  it('maps INVALID_CREDENTIALS → INVALID_CREDENTIALS/401', () => {
    const e = toAppError(new ProviderError('INVALID_CREDENTIALS', 'raw zitadel detail'));
    expect(e.code).to.equal('INVALID_CREDENTIALS');
    expect(e.status).to.equal(401);
  });
  it('maps PERMISSION_DENIED → FORBIDDEN/403', () => {
    expect(toAppError(new ProviderError('PERMISSION_DENIED', 'x')).code).to.equal('FORBIDDEN');
  });
  it('maps ALREADY_EXISTS → CONFLICT/409', () => {
    expect(toAppError(new ProviderError('ALREADY_EXISTS', 'x')).status).to.equal(409);
  });
  it('degrades an unknown provider code to UNEXPECTED/500', () => {
    const e = toAppError(new ProviderError('SOME_NEW_CODE' as never, 'x'));
    expect(e.code).to.equal('UNEXPECTED');
    expect(e.status).to.equal(500);
  });
  it('degrades a non-ProviderError to UNEXPECTED and never leaks raw text', () => {
    const e = toAppError(new Error('postgres exploded at 10.0.0.4'));
    expect(e.code).to.equal('UNEXPECTED');
    expect(JSON.stringify(e)).not.to.include('postgres');
  });
});
