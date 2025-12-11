import { SignInWithIdp } from "@/components/sign-in-with-idp";
import { Translated } from "@/components/translated";
import { getMostRecentSessionCookie } from "@/lib/cookies";
import { idpTypeToSlug } from "@/lib/idp";
import { generateRouteMetadata } from "@/lib/metadata";
import { redirectToIdp } from "@/lib/server/idp";
import { getServiceUrlFromHeaders } from "@/lib/service-url";
import {
  getActiveIdentityProviders,
  getSession,
  listIDPLinks,
} from "@/lib/zitadel";
import { IdentityProviderType } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb";
import { IDPLink } from "@zitadel/proto/zitadel/user/v2/idp_pb";
import { headers } from "next/headers";

import { Alert, AlertType } from "@/components/alert";
import googleLogo from "@/components/assets/google.svg";
import { GitHubLogo } from "@/components/idps/sign-in-with-github";

import Image from "next/image";

export const metadata = generateRouteMetadata("idp");

export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const requestId = searchParams?.requestId;
  let organization = searchParams?.organization;
  const authProvider = searchParams?.provider;

  const _headers = await headers();
  const { serviceUrl } = getServiceUrlFromHeaders(_headers);

  // If no org supplied use instance default like loginname page
  if (!organization) {
    const { getDefaultOrg } = await import("@/lib/zitadel");
    const org = await getDefaultOrg({ serviceUrl });
    if (org) organization = org.id;
  }

  const activeIdentityProviders = await getActiveIdentityProviders({
    serviceUrl,
    orgId: organization,
  }).then((resp) => {
    return resp.identityProviders;
  });

  // resolve current user and linked IDPs
  let userId: string | undefined;
  type Linked = {
    idpId: string;
    idpType: IdentityProviderType;
    idpName: string;
  };
  let linkedIdps: Linked[] = [];

  try {
    const recentCookie = await getMostRecentSessionCookie();
    const { session } = await getSession({
      serviceUrl,
      sessionId: recentCookie.id,
      sessionToken: recentCookie.token,
    });
    userId = session?.factors?.user?.id;
  } catch {}

  // If not logged in show error
  if (!userId) {
    return (
      <>
        <h1>
          <Translated i18nKey="error.sessionExpired" namespace="error" />
        </h1>
        <p className="ztdl-p">
          <Translated i18nKey="error.noActiveSession" namespace="idp" />
        </p>
      </>
    );
  }

  // if ?provider=google etc. provided, immediately launch linking
  if (authProvider && activeIdentityProviders?.length) {
    const desired = activeIdentityProviders.find(
      (p) => idpTypeToSlug(p.type) === authProvider.toLowerCase(),
    );

    if (desired) {
      const form = new FormData();
      form.set("id", desired.id);
      form.set("provider", authProvider.toLowerCase());
      form.set("linkOnly", "true");
      form.set("userId", userId);
      if (requestId) form.set("requestId", requestId);
      if (organization) form.set("organization", organization);

      await redirectToIdp(undefined, form);
    }
  }

  try {
    const response = await listIDPLinks({ serviceUrl, userId });
    linkedIdps = response.result?.map((l: IDPLink) => {
      const match = activeIdentityProviders?.find((p) => p.id === l.idpId);
      return {
        idpId: l.idpId,
        idpType: match?.type,
        idpName: match?.name ?? l.userName ?? l.idpId,
      } as Linked;
    });
  } catch (e) {
    console.warn("Could not load linked IDPs", e);
  }

  const unlinkedIdentityProviders = activeIdentityProviders?.filter(
    (p) => !linkedIdps.some((l) => l.idpId === p.id),
  );

  return (
    <>
      <h1 className="mb-4">
        <Translated i18nKey="link.title" namespace="idp" />
      </h1>

      {linkedIdps && linkedIdps.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold mb-2">
            <Translated
              i18nKey={`link.linked.${linkedIdps.length === 1 ? "singular" : "plural"}`}
              namespace="idp"
            />
          </h2>
          <ul className="space-y-2">
            {linkedIdps.map((l) => {
              let icon: React.ReactNode = null;
              switch (l.idpType) {
                case IdentityProviderType.GOOGLE:
                  icon = (
                    <Image
                      src={googleLogo}
                      alt="google"
                      width={20}
                      height={20}
                      className="rounded"
                    />
                  );
                  break;
                case IdentityProviderType.GITHUB:
                case IdentityProviderType.GITHUB_ES:
                  icon = (
                    <span className="h-5 w-5 flex items-center justify-center">
                      <GitHubLogo />
                    </span>
                  );
                  break;
              }

              return (
                <li key={l.idpId} className="flex items-center text-sm gap-2">
                  <span className="mr-2">{icon}</span>
                  <span>{l.idpName}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <h2 className="text-sm font-semibold mb-2">
        <Translated i18nKey="link.description" namespace="idp" />
      </h2>

      {unlinkedIdentityProviders && unlinkedIdentityProviders.length > 0 ? (
        <SignInWithIdp
          identityProviders={unlinkedIdentityProviders}
          requestId={requestId}
          organization={organization}
          linkOnly={true}
          userId={userId}
        />
      ) : (
        <Alert type={AlertType.INFO}>
          <Translated i18nKey="link.noMoreProviders" namespace="idp" />
        </Alert>
      )}
    </>
  );
}
