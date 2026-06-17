import { normalizeError, toRegisterRequest } from './mappers';
import { ProviderError } from '@/modules/auth/types';
import { describe, it, expect } from 'vitest';

// minimal ConnectError shape
const ce = (code: number, message = 'boom', details: unknown[] = []) => ({
  code,
  message,
  findDetails: () => details,
});

// ── normalizeError Phase 2 extensions ────────────────────────────────────────

describe('normalizeError Phase 2 extensions', () => {
  it('code 3 + /complexity/i → PASSWORD_COMPLEXITY', () => {
    const e = normalizeError(ce(3, 'Password does not meet complexity requirements'));
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.code).toBe('PASSWORD_COMPLEXITY');
  });

  it('code 3 WITHOUT complexity → still INVALID_CREDENTIALS (P1 not broken)', () => {
    const e = normalizeError(ce(3, 'invalid credentials'));
    expect(e.code).toBe('INVALID_CREDENTIALS');
  });

  it('code 6 → ALREADY_EXISTS', () => {
    const e = normalizeError(ce(6, 'user already exists'));
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.code).toBe('ALREADY_EXISTS');
  });

  it('code 9 + /already/i → ALREADY_DONE', () => {
    const e = normalizeError(ce(9, 'email already verified'));
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.code).toBe('ALREADY_DONE');
  });

  it('code 9 + /verified/i → ALREADY_DONE', () => {
    const e = normalizeError(ce(9, 'already verified'));
    expect(e.code).toBe('ALREADY_DONE');
  });

  // P1 regression: failedAttempts still wins over message discrimination
  it('code 3 + failedAttempts detail → INVALID_CREDENTIALS (P1 preserved)', () => {
    const e = normalizeError(ce(3, 'complexity check', [{ failedAttempts: 1 }]));
    expect(e.code).toBe('INVALID_CREDENTIALS');
    expect(e.detail?.failedAttempts).toBe(1);
  });
});

// ── toRegisterRequest ─────────────────────────────────────────────────────────

describe('toRegisterRequest', () => {
  it('maps minimal input (no password, no orgId) to AddHumanUser shape', () => {
    const req = toRegisterRequest({
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Smith',
    });
    expect(req.profile).toEqual({ givenName: 'Alice', familyName: 'Smith' });
    expect(req.email).toEqual({ email: 'alice@example.com' });
    expect(req.organization).toBeUndefined();
    expect(req.passwordType.case).toBeUndefined();
  });

  it('includes organization oneof when orgId provided', () => {
    const req = toRegisterRequest({
      email: 'bob@example.com',
      firstName: 'Bob',
      lastName: 'Jones',
      orgId: 'org-123',
    });
    expect(req.organization).toEqual({ org: { case: 'orgId', value: 'org-123' } });
  });

  it('includes passwordType oneof when password provided', () => {
    const req = toRegisterRequest({
      email: 'charlie@example.com',
      firstName: 'Charlie',
      lastName: 'Brown',
      password: 'Secret123!',
    });
    expect(req.passwordType).toEqual({
      case: 'password',
      value: { password: 'Secret123!', changeRequired: false },
    });
  });

  it('omits the email verification oneof when no verifyUrlTemplate is given', () => {
    // Default: no verification oneof → Zitadel sends the email with its built-in
    // url. (Proto: "If no verification is specified, an email is sent with the
    // default url.") We only override it when a template is supplied.
    const req = toRegisterRequest({
      email: 'dana@example.com',
      firstName: 'Dana',
      lastName: 'Scully',
    });
    expect(req.email).toEqual({ email: 'dana@example.com' });
    expect((req.email as { verification?: unknown }).verification).toBeUndefined();
  });

  it('sets the email sendCode verification urlTemplate when verifyUrlTemplate is given', () => {
    // Steers the verification email link back to OUR /verify route so the
    // "click the link" continuation stays inside auth-ui. Placeholders are
    // filled by Zitadel: {{.Code}}, {{.UserID}}, {{.OrgID}}.
    const tmpl =
      'https://localhost:3000/id/verify?code={{.Code}}&userId={{.UserID}}&organization={{.OrgID}}';
    const req = toRegisterRequest({
      email: 'fox@example.com',
      firstName: 'Fox',
      lastName: 'Mulder',
      verifyUrlTemplate: tmpl,
    });
    expect(req.email).toEqual({
      email: 'fox@example.com',
      verification: { case: 'sendCode', value: { urlTemplate: tmpl } },
    });
  });
});
