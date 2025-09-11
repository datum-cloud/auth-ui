import { SignInWithIdp } from "@/components/sign-in-with-idp";
import { Translated } from "@/components/translated";
import { generateRouteMetadata } from "@/lib/metadata";
import { getServiceUrlFromHeaders } from "@/lib/service-url";
import { getActiveIdentityProviders } from "@/lib/zitadel";
import { headers } from "next/headers";

export const metadata = generateRouteMetadata("idp");

export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
}) {
  const searchParams = await props.searchParams;

  const requestId = searchParams?.requestId;
  const organization = searchParams?.organization;

  const _headers = await headers();
  const { serviceUrl } = getServiceUrlFromHeaders(_headers);

  const identityProviders = await getActiveIdentityProviders({
    serviceUrl,
    orgId: organization,
  }).then((resp) => {
    return resp.identityProviders;
  });

  return (
    <>
      <h1>
        <Translated i18nKey="title" namespace="idp" />
      </h1>
      <p className="ztdl-p description">
        <Translated i18nKey="description" namespace="idp" />
      </p>

      {identityProviders && (
        <SignInWithIdp
          identityProviders={identityProviders}
          requestId={requestId}
          organization={organization}
        ></SignInWithIdp>
      )}
    </>
  );
}
