import { userCodeSchema } from '@/resources/schemas/user-code';

describe('userCodeSchema', () => {
  it('accepts an OAuth device user_code shape', () => {
    expect(userCodeSchema.safeParse('WDJB-MJHT').success).to.be.true;
  });

  it('accepts underscores', () => {
    expect(userCodeSchema.safeParse('WDJB_MJHT').success).to.be.true;
  });

  it('rejects query-injection characters — SECURITY', () => {
    expect(userCodeSchema.safeParse('X&loginName=admin').success).to.be.false;
  });

  it('rejects a value over 64 characters', () => {
    expect(userCodeSchema.safeParse('A'.repeat(65)).success).to.be.false;
  });

  it('treats absence as valid (optional)', () => {
    const r = userCodeSchema.safeParse(undefined);
    expect(r.success).to.be.true;
    expect(r.success && r.data).to.equal(undefined);
  });
});
