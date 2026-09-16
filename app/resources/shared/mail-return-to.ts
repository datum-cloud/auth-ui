// app/resources/shared/mail-return-to.ts
//
// Builds the `returnTo` we hand the zitadel-provider mail webhook. The webhook (buildActionURL)
// appends its OWN `?code=...&userId=...` onto whatever it is given — unlike verifyUrlTemplate /
// signupCompleteUrlTemplate, which hand Zitadel a template carrying literal {{.Code}}/{{.UserID}}/
// {{.OrgID}} placeholders for ZITADEL to substitute. There is no such substitution pass here, so
// this builds `returnTo` with REAL values: the caller supplies whatever it already resolved
// (organization, requestId).
//
// Shared because signup and recovery both mail links back into this app, and a second copy of
// this three-line builder is how the two flows would start disagreeing about where a user lands.
import { APP_BASENAME } from '@/resources/shared/app-basename';

export function mailReturnTo(
  origin: string,
  path: string,
  params: { requestId?: string; organization?: string; next?: string }
): string {
  const qs = new URLSearchParams();
  if (params.requestId) qs.set('requestId', params.requestId);
  if (params.organization) qs.set('organization', params.organization);
  if (params.next) qs.set('next', params.next);
  const query = qs.toString();
  return `${origin}${APP_BASENAME}${path}${query ? `?${query}` : ''}`;
}
