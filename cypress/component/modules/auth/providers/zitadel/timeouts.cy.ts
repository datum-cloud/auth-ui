// cypress/component/modules/auth/providers/zitadel/timeouts.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/timeouts.test.ts.
// Pure constant export — browser-side Chai only.
import { TIMEOUTS } from '@/modules/auth/providers/zitadel/timeouts';

describe('TIMEOUTS', () => {
  it('exposes a positive admin-check deadline in ms', () => {
    expect(TIMEOUTS.ADMIN_CHECK_MS).to.be.greaterThan(0);
    expect(TIMEOUTS.ADMIN_CHECK_MS).to.be.at.most(30_000);
  });

  it('exposes a positive gRPC per-call deadline in ms', () => {
    expect(TIMEOUTS.GRPC_CALL_MS).to.be.greaterThan(0);
    expect(TIMEOUTS.GRPC_CALL_MS).to.be.at.most(30_000);
  });
});
