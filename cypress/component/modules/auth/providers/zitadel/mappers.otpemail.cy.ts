// cypress/component/modules/auth/providers/zitadel/mappers.otpemail.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/mappers.otpemail.test.ts.
// Pure toChallengeRequest mapper — browser-side Chai only.
//
// send / send-template kinds are already exercised in mappers.p5.cy.ts; kept here is only the
// return-code kind, the one branch unique to this spec.
import { toChallengeRequest } from '@/modules/auth/providers/zitadel/mappers';

describe('toChallengeRequest — otpEmail returnCode', () => {
  it("maps { kind: 'return-code' } to the proto returnCode delivery case, omitting other fields", () => {
    const result = toChallengeRequest({ otpEmail: { kind: 'return-code' } });
    expect(result.otpEmail).to.deep.equal({
      deliveryType: { case: 'returnCode', value: {} },
    });
    expect(result.webAuthN).to.be.undefined;
    expect(result.otpSms).to.be.undefined;
  });
});
