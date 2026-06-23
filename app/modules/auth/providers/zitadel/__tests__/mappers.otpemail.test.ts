import { toChallengeRequest } from '../mappers';
import { describe, it, expect } from 'vitest';

// otpEmail challenge is the OtpEmailChallenge discriminated union ({ kind: ... }).
describe('toChallengeRequest — otpEmail returnCode', () => {
  it("maps { kind: 'return-code' } to proto returnCode delivery case", () => {
    const result = toChallengeRequest({ otpEmail: { kind: 'return-code' } });
    expect(result.otpEmail).toEqual({
      deliveryType: { case: 'returnCode', value: {} },
    });
  });

  it('does not include webAuthN or otpSms when only otpEmail return-code is given', () => {
    const result = toChallengeRequest({ otpEmail: { kind: 'return-code' } });
    expect(result.webAuthN).toBeUndefined();
    expect(result.otpSms).toBeUndefined();
  });

  it("still maps { kind: 'send' } (sendCode default) correctly", () => {
    const result = toChallengeRequest({ otpEmail: { kind: 'send' } });
    expect(result.otpEmail).toEqual({
      deliveryType: { case: 'sendCode', value: {} },
    });
  });

  it("still maps { kind: 'send-template' } (sendCode with template) correctly", () => {
    const result = toChallengeRequest({
      otpEmail: { kind: 'send-template', urlTemplate: 'https://example.com/otp?code={{.Code}}' },
    });
    expect(result.otpEmail).toEqual({
      deliveryType: {
        case: 'sendCode',
        value: { urlTemplate: 'https://example.com/otp?code={{.Code}}' },
      },
    });
  });
});
