export interface EmailVerificationInput {
  emailVerified: boolean;
  requireVerification: boolean;
  loginName: string;
  organization?: string;
  requestId?: string;
}

export interface GateResult {
  redirect: string;
}

export function emailVerificationGate(input: EmailVerificationInput): GateResult | null {
  if (input.emailVerified || !input.requireVerification) return null;
  const p = new URLSearchParams({ loginName: input.loginName, send: 'true' });
  if (input.organization) p.set('organization', input.organization);
  if (input.requestId) p.set('requestId', input.requestId);
  return { redirect: `/verify?${p.toString()}` };
}
