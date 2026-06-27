// cypress/component/modules/auth/providers/zitadel/mappers.otpemail.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/mappers.otpemail.test.ts.
// Pure toChallengeRequest mapper — browser-side Chai only.
import { toChallengeRequest } from '@/modules/auth/providers/zitadel/mappers';

// otpEmail challenge is the OtpEmailChallenge discriminated union ({ kind: ... }).
describe('toChallengeRequest — otpEmail returnCode', () => {
  it("maps { kind: 'return-code' } to proto returnCode delivery case", () => {
    const result = toChallengeRequest({ otpEmail: { kind: 'return-code' } });
    expect(result.otpEmail).to.deep.equal({
      deliveryType: { case: 'returnCode', value: {} },
    });
  });

  it('does not include webAuthN or otpSms when only otpEmail return-code is given', () => {
    const result = toChallengeRequest({ otpEmail: { kind: 'return-code' } });
    expect(result.webAuthN).to.be.undefined;
    expect(result.otpSms).to.be.undefined;
  });

  it("still maps { kind: 'send' } (sendCode default) correctly", () => {
    const result = toChallengeRequest({ otpEmail: { kind: 'send' } });
    expect(result.otpEmail).to.deep.equal({
      deliveryType: { case: 'sendCode', value: {} },
    });
  });

  it("still maps { kind: 'send-template' } (sendCode with template) correctly", () => {
    const result = toChallengeRequest({
      otpEmail: { kind: 'send-template', urlTemplate: 'https://example.com/otp?code={{.Code}}' },
    });
    expect(result.otpEmail).to.deep.equal({
      deliveryType: {
        case: 'sendCode',
        value: { urlTemplate: 'https://example.com/otp?code={{.Code}}' },
      },
    });
  });
});
