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
import { IDPLink } from "@zitadel/proto/zitadel/user/v2/idp_pb";
import { headers } from "next/headers";

import { Alert, AlertType } from "@/components/alert";

import { LinkedIdp, LinkedIdpList } from "@/components/linked-idp-list";
import Link from "next/link";

export const metadata = generateRouteMetadata("idp");

export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const requestId = searchParams?.requestId;
  let organization = searchParams?.organization;
  const authProvider = searchParams?.provider;
  const actualProvider = searchParams?.actualProvider;
  const onSuccessRedirectTo = searchParams?.onSuccessRedirectTo;

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
  let userLoginName: string | undefined;
  let linkedIdps: LinkedIdp[] = [];

  try {
    const recentCookie = await getMostRecentSessionCookie();
    const { session } = await getSession({
      serviceUrl,
      sessionId: recentCookie.id,
      sessionToken: recentCookie.token,
    });
    userId = session?.factors?.user?.id;
    userLoginName = session?.factors?.user?.loginName;
  } catch {}

  // If not logged in, prompt user to sign-in with the chosen provider
  if (!userId) {
    let providersToShow = activeIdentityProviders;

    if (actualProvider && activeIdentityProviders?.length) {
      const desired = activeIdentityProviders.find(
        (p) => idpTypeToSlug(p.type) === actualProvider.toLowerCase(),
      );
      if (desired) {
        providersToShow = [desired];
      }
    }

    return (
      <>
        <h1 className="mb-4">
          <Translated i18nKey="link.title" namespace="idp" />
        </h1>
        <h2 className="text-sm font-semibold mb-2">
          <Translated i18nKey="link.signInRequired" namespace="idp" />
        </h2>
        <Alert type={AlertType.INFO}>
          <Translated i18nKey="link.signInDescription" namespace="idp" />
        </Alert>

        {providersToShow && providersToShow.length > 0 && (
          <SignInWithIdp
            identityProviders={providersToShow}
            requestId={requestId}
            organization={organization}
            preventCreation={true} // prevent account creation in case they login with a wrong account
            onSuccessRedirectTo={(() => {
              // redirect back to the link page with all the params
              const params = new URLSearchParams();
              Object.entries(searchParams ?? {}).forEach(([k, v]) => {
                if (v) params.set(k.toString(), v as string);
              });
              const qs = params.toString();
              return `/idp/link${qs ? `?${qs}` : ""}`;
            })()}
          />
        )}
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
        userName: l.userName,
        linkedUserId: l.userId,
      } as LinkedIdp;
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
        <div className="mb-6 w-full">
          <h2 className="text-sm font-semibold mb-2">
            <Translated
              i18nKey={`link.linked.${linkedIdps.length === 1 ? "singular" : "plural"}`}
              namespace="idp"
            />
          </h2>
          <ul className="space-y-2">
            <LinkedIdpList
              linkedIdps={linkedIdps}
              allowUnlink={process.env.ALLOW_IDP_UNLINK === "true"}
            />
          </ul>
        </div>
      )}

      <h2 className="text-sm font-semibold mb-2">
        <Translated i18nKey="link.description" namespace="idp" />
      </h2>

      {activeIdentityProviders && activeIdentityProviders.length > 0 ? (
        <SignInWithIdp
          identityProviders={activeIdentityProviders}
          requestId={requestId}
          organization={organization}
          linkOnly={true}
          userId={userId}
          onSuccessRedirectTo={"/idp/link"}
        />
      ) : (
        <Alert type={AlertType.INFO}>
          <Translated i18nKey="link.noMoreProviders" namespace="idp" />
        </Alert>
      )}

      <div className="mt-6 flex flex-col items-center justify-center">
        {userLoginName && (
          <span className="text-sm text-gray-300">{userLoginName}</span>
        )}
        <Link href="/logout" className="text-sm text-gray-500 hover:underline">
          <Translated i18nKey="title" namespace="logout" />
        </Link>
      </div>
    </>
  );
}
