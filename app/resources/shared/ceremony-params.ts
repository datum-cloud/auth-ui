// Leaf reader for the ceremony-context triplet carried on every login/signup/setup
// URL: loginName (defaults to '' so downstream guards treat "absent" as empty),
// plus the optional requestId/organization. Only the EXACT verbatim triplet sites
// adopt this — partial/subset readers (password/*, verify/index defaulting loginName
// to undefined) intentionally stay bespoke.
export interface CeremonyParams {
  loginName: string;
  requestId?: string;
  organization?: string;
}

export function readCeremonyParams(url: URL): CeremonyParams {
  return {
    loginName: url.searchParams.get('loginName') ?? '',
    requestId: url.searchParams.get('requestId') ?? undefined,
    organization: url.searchParams.get('organization') ?? undefined,
  };
}
