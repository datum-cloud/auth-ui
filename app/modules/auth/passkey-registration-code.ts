// app/modules/auth/passkey-registration-code.ts
//
// CONTRACT: the opaque `code` string that travels between `passkeyRegisterLink` and
// `registerPasskey` on the AuthProvider port. Zitadel's PasskeyRegistrationCode is a PAIR —
// `{ id, code }` — but the port carries a single string, so the pair is encoded here and
// decoded there. Keeping the codec in `app/modules/auth/` (not in a provider) is what lets the
// recovery resource and the providers both import it without a layering violation: recovery has
// to split the envelope apart to mail `codeId` and `code` as separate variables, then put them
// back together when the ceremony starts.
//
// SECURITY: `code` is a bearer credential. It is never logged, never placed in an error message,
// and never stored anywhere but the mail body and the form field. `id` (the `codeId`) is not
// secret on its own and may be logged and carried in the sealed ticket.
//
// The wire shape is unchanged from the inline `JSON.stringify` this replaced — an existing
// envelope minted before this module still decodes.

export interface PasskeyRegistrationCode {
  id: string;
  code: string;
}

/** Encode the Zitadel `{ id, code }` pair as the port's single opaque string. */
export function encodePasskeyRegistrationCode(c: PasskeyRegistrationCode): string {
  return JSON.stringify({ id: c.id, code: c.code });
}

/**
 * Decode an opaque code string back into the pair. Returns `null` — never throws — for anything
 * that is not a complete envelope: malformed JSON, a missing half, a non-string half, or an
 * empty one. Legacy direct callers pass an arbitrary opaque string and land here as `null`.
 */
export function decodePasskeyRegistrationCode(opaque: string): PasskeyRegistrationCode | null {
  try {
    const parsed: unknown = JSON.parse(opaque);
    if (parsed === null || typeof parsed !== 'object') return null;
    const { id, code } = parsed as { id?: unknown; code?: unknown };
    if (typeof id !== 'string' || typeof code !== 'string') return null;
    if (id === '' || code === '') return null;
    return { id, code };
  } catch {
    return null;
  }
}
