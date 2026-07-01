import { webauthnAssertionSchema } from '@/resources/webauthn/webauthn-verify';

describe('webauthnAssertionSchema', () => {
  it('validates the assertion form and rejects a missing credential', () => {
    expect(
      webauthnAssertionSchema.safeParse({ credential: 'x', loginName: 'a@b.c' }).success
    ).to.equal(true);
    expect(webauthnAssertionSchema.safeParse({ loginName: 'a@b.c' }).success).to.equal(false);
  });
});
