// app/resources/recovery/recovery-ticket.server.ts
//
// Tickets, not sessions, carry state between the steps of a recovery. `/recover` and
// `/recover/complete` never read the sessions cookie and never apply the sudo gate — the mailed
// code is the authorisation — so the two facts the flow has to remember between requests live in
// sealed cookies instead:
//
//   request ticket   set on EVERY /recover POST. Binds the typed code to the device that asked:
//                    it carries the userId and codeId the requester never sees, bound to
//                    hash(email) so a ticket cannot be replayed for another address.
//   ceremony ticket  set when a code is successfully consumed. Binds the WebAuthn verify to the
//                    request that consumed the code, so the verify step cannot be driven with a
//                    client-chosen userId or passkeyId.
//
// FIXED LENGTH IS THE POINT (G7). Every /recover POST must produce a byte-identical response
// across fresh / verified / unverified / unknown / org-refused / rate-limited / bot-rejected —
// Set-Cookie included. So the plaintext is a fixed-width record, which makes the ciphertext a
// fixed width, and an exit that issued nothing sets a FILLER of that same width instead of no
// cookie. Filler and real are indistinguishable: same length, both random-looking, and a filler
// simply opens to null. Nothing in this module may become variable-length — that is why the ids
// are padded into fixed fields and why `secrets` is deliberately NOT passed to createCookie: an
// HMAC wrapper would append a signature whose length varies, and the value is already sealed
// (encrypted AND authenticated) by AES-GCM.
//
// SECURITY: the ticket carries `codeId`, NEVER `code`. Whoever holds the ticket still needs the
// code from the inbox. Sealing is AES-256-GCM under a key derived from SESSION_SECRET via HKDF,
// so the ticket is opaque and tamper-evident; the expiry rides inside the sealed plaintext and
// so cannot be extended by the client.
import { APP_BASENAME } from '@/resources/shared/app-basename';
import { env } from '@/server/infra/env.server';
import { logAuthEvent } from '@/server/observability';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { createCookie } from 'react-router';

/** Matches infra's Zitadel `SecretGenerators.PasswordlessInitCode.Expiry` — the ticket must not
 *  outlive the code it refers to, and must not expire before it either. */
export const RECOVERY_TICKET_TTL_MS = 60 * 60_000;
/** The WebAuthn ceremony is a single interaction; ten minutes covers a slow authenticator. */
export const RECOVERY_CEREMONY_TTL_MS = 10 * 60_000;

// Key derived from the app secret, never used raw; the info string versions the format, so a
// future layout change invalidates old tickets instead of misreading them.
const KEY = Buffer.from(
  hkdfSync('sha256', env.SESSION_SECRET, '', 'auth-ui/recovery-ticket/v1', 32)
);
const FIELD = 40; // bytes per id field (Zitadel ids are 18-19 digits; 40 leaves room)
const KIND = { filler: 0, request: 1, ceremony: 2 } as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HASH_BYTES = 16;
const EXP_BYTES = 8;
// kind | a | b | emailHash | expMs - FIXED length, so the ciphertext is a fixed length too.
const PLAIN = 1 + FIELD + FIELD + HASH_BYTES + EXP_BYTES;
const HASH_OFFSET = 1 + FIELD + FIELD;
const EXP_OFFSET = HASH_OFFSET + HASH_BYTES;

function emailHash(email: string): Buffer {
  return createHash('sha256').update(email.trim().toLowerCase()).digest().subarray(0, HASH_BYTES);
}

/** Pads an id into its fixed-width field. Callers must have rejected over-long ids already. */
function fixed(s: string): Buffer {
  const b = Buffer.alloc(FIELD);
  Buffer.from(s, 'utf8').copy(b);
  return b;
}

function expiryBuffer(exp: number): Buffer {
  const b = Buffer.alloc(EXP_BYTES);
  b.writeBigUInt64BE(BigInt(exp));
  return b;
}

function seal(plain: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  return Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]).toString('base64url');
}

function open(raw: string | null): Buffer | null {
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64url');
    if (buf.length !== IV_BYTES + PLAIN + TAG_BYTES) return null;
    const d = createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, IV_BYTES));
    d.setAuthTag(buf.subarray(IV_BYTES + PLAIN));
    return Buffer.concat([
      d.update(buf.subarray(IV_BYTES, IV_BYTES + PLAIN)),
      d.final(), // throws on a bad auth tag - tampering lands in the catch
    ]);
  } catch {
    return null;
  }
}

function build(kind: number, a: string, b: string, h: Buffer, exp: number): Buffer {
  return Buffer.concat([Buffer.from([kind]), fixed(a), fixed(b), h, expiryBuffer(exp)]);
}

function field(p: Buffer, off: number): string {
  return p
    .subarray(off, off + FIELD)
    .toString('utf8')
    .replace(/\0+$/, '');
}

function unexpired(p: Buffer, now: number): boolean {
  return Number(p.readBigUInt64BE(EXP_OFFSET)) > now;
}

function tooLong(...ids: string[]): boolean {
  return ids.some((id) => Buffer.byteLength(id, 'utf8') > FIELD);
}

/**
 * A ticket that opens to nothing, of exactly the same length as a real one. Set on every
 * /recover exit that issued no code. The id fields carry random bytes, not zeros, so a filler
 * and a real ticket have the same ciphertext entropy profile.
 */
export function fillerTicket(now: number = Date.now()): string {
  return seal(
    Buffer.concat([
      Buffer.from([KIND.filler]),
      randomBytes(FIELD),
      randomBytes(FIELD),
      randomBytes(HASH_BYTES),
      expiryBuffer(now + RECOVERY_TICKET_TTL_MS),
    ])
  );
}

/**
 * Seals `{ userId, codeId }` bound to `hash(email)`. NEVER THROWS: an over-long id degrades to a
 * filler and an audit line, because a throw inside the /recover action would change the response
 * and become exactly the enumeration oracle the fixed length exists to prevent.
 */
export function sealRequestTicket(
  p: { userId: string; codeId: string; email: string },
  now: number = Date.now()
): string {
  if (tooLong(p.userId, p.codeId)) {
    logAuthEvent('recovery_ticket', 'failure', { reason: 'id_too_long' });
    return fillerTicket(now);
  }
  return seal(
    build(KIND.request, p.userId, p.codeId, emailHash(p.email), now + RECOVERY_TICKET_TTL_MS)
  );
}

/**
 * Opens a request ticket for `email`. Returns null - one answer for every failure - when the
 * ticket is absent, filler, tampered, expired, of the wrong kind, or was issued for a different
 * address. The caller renders one generic message for all of them.
 */
export function openRequestTicket(
  raw: string | null,
  email: string,
  now: number = Date.now()
): { userId: string; codeId: string } | null {
  const p = open(raw);
  if (!p || p[0] !== KIND.request || !unexpired(p, now)) return null;
  // Constant-time: the address is attacker-supplied and the hash is the binding.
  if (!timingSafeEqual(emailHash(email), p.subarray(HASH_OFFSET, HASH_OFFSET + HASH_BYTES))) {
    return null;
  }
  return { userId: field(p, 1), codeId: field(p, 1 + FIELD) };
}

/**
 * Seals `{ userId, passkeyId }` for the verify step. No email binding: the code was already
 * consumed to get here, and the ceremony's TTL is short. Degrades to a filler on an over-long id
 * for the same reason as above.
 */
export function sealCeremonyTicket(
  p: { userId: string; passkeyId: string },
  now: number = Date.now()
): string {
  if (tooLong(p.userId, p.passkeyId)) {
    logAuthEvent('recovery_ticket', 'failure', { reason: 'id_too_long' });
    return fillerTicket(now);
  }
  return seal(
    build(
      KIND.ceremony,
      p.userId,
      p.passkeyId,
      Buffer.alloc(HASH_BYTES),
      now + RECOVERY_CEREMONY_TTL_MS
    )
  );
}

/** Opens a ceremony ticket. Null on absent / filler / tampered / expired / wrong kind. */
export function openCeremonyTicket(
  raw: string | null,
  now: number = Date.now()
): { userId: string; passkeyId: string } | null {
  const p = open(raw);
  if (!p || p[0] !== KIND.ceremony || !unexpired(p, now)) return null;
  return { userId: field(p, 1), passkeyId: field(p, 1 + FIELD) };
}

// Scoped to the recover routes so the ticket is not attached to any other request, and NOT given
// `secrets`: see the fixed-length note in the header. maxAge mirrors each ticket's own TTL, but
// the authoritative expiry is the one sealed inside the value - a client that keeps the cookie
// past maxAge still gets null.
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: `${APP_BASENAME}/recover`,
  secure: env.NODE_ENV === 'production',
} as const;

export const recoveryTicketCookie = createCookie('recovery_ticket', {
  ...cookieOptions,
  maxAge: RECOVERY_TICKET_TTL_MS / 1000,
});

export const recoveryCeremonyCookie = createCookie('recovery_ceremony', {
  ...cookieOptions,
  maxAge: RECOVERY_CEREMONY_TTL_MS / 1000,
});
