import { describe, it, expect } from 'vitest';
import { toChallengeRequest } from './mappers';

describe('toChallengeRequest — otpEmail returnCode', () => {
  it('maps { returnCode: true } to proto returnCode delivery case', () => {
    const result = toChallengeRequest({ otpEmail: { returnCode: true } });
    expect(result.otpEmail).toEqual({
      deliveryType: { case: 'returnCode', value: {} },
    });
  });

  it('does not include webAuthN or otpSms when only otpEmail returnCode is given', () => {
    const result = toChallengeRequest({ otpEmail: { returnCode: true } });
    expect(result.webAuthN).toBeUndefined();
    expect(result.otpSms).toBeUndefined();
  });

  it('still maps true (sendCode default) correctly', () => {
    const result = toChallengeRequest({ otpEmail: true });
    expect(result.otpEmail).toEqual({
      deliveryType: { case: 'sendCode', value: {} },
    });
  });

  it('still maps { urlTemplate } (sendCode with template) correctly', () => {
    const result = toChallengeRequest({ otpEmail: { urlTemplate: 'https://example.com/otp?code={{.Code}}' } });
    expect(result.otpEmail).toEqual({
      deliveryType: {
        case: 'sendCode',
        value: { urlTemplate: 'https://example.com/otp?code={{.Code}}' },
      },
    });
  });
});
