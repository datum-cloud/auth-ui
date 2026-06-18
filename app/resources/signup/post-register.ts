import { emailVerificationGate } from '@/resources/verify/email-verification';

export interface PostRegisterInput {
  hasPassword: boolean;
  emailVerified: boolean;
  requireVerification: boolean;
  loginName: string;
  userId: string;
  organization?: string;
  requestId?: string;
}

export function postRegisterStep(input: PostRegisterInput): string {
  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ loginName: input.loginName, userId: input.userId, ...extra });
    if (input.organization) p.set('organization', input.organization);
    if (input.requestId) p.set('requestId', input.requestId);
    return p.toString();
  };
  if (!input.hasPassword) return `/setup/passkey?${q({ force: 'false', checkAfter: 'true' })}`;
  const gate = emailVerificationGate({
    emailVerified: input.emailVerified,
    requireVerification: input.requireVerification,
    loginName: input.loginName,
    organization: input.organization,
    requestId: input.requestId,
  });
  if (gate) {
    // gate is loginName/org/requestId-scoped; append userId here since postRegisterStep owns it
    const extra = new URLSearchParams({ userId: input.userId });
    return `${gate.redirect}&${extra.toString()}`;
  }
  if (input.requestId) return `/authorize?requestId=${encodeURIComponent(input.requestId)}`;
  return '/signed-in';
}
