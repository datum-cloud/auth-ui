import { webauthnAssertionSchema } from '@/resources/webauthn/webauthn-verify';

describe('webauthnAssertionSchema', () => {
  it('validates the four-field assertion form', () => {
    const ok = webauthnAssertionSchema.safeParse({ credential: 'x', loginName: 'a@b.c' });
    expect(ok.success).to.equal(true);
  });

  it('rejects a missing credential', () => {
    expect(webauthnAssertionSchema.safeParse({ loginName: 'a@b.c' }).success).to.equal(false);
  });
});
