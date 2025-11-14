import { SignInWithIdp } from "@/components/sign-in-with-idp";
import { Translated } from "@/components/translated";
import { UsernameForm } from "@/components/username-form";
import { generateRouteMetadata } from "@/lib/metadata";
import { getServiceUrlFromHeaders } from "@/lib/service-url";
import {
  getActiveIdentityProviders,
  getDefaultOrg,
  getLoginSettings,
} from "@/lib/zitadel";
import { Organization } from "@zitadel/proto/zitadel/org/v2/org_pb";
import { headers } from "next/headers";

import { RegisterBtn } from "./_register-btn";

export const metadata = generateRouteMetadata("login");

export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
}) {
  const searchParams = await props.searchParams;

  const loginName = searchParams?.loginName;
  const requestId = searchParams?.requestId;
  const organization = searchParams?.organization;
  const suffix = searchParams?.suffix;
  const submit: boolean = searchParams?.submit === "true";

  const _headers = await headers();
  const { serviceUrl } = getServiceUrlFromHeaders(_headers);

  let defaultOrganization;
  if (!organization) {
    const org: Organization | null = await getDefaultOrg({
      serviceUrl,
    });
    if (org) {
      defaultOrganization = org.id;
    }
  }

  const loginSettings = await getLoginSettings({
    serviceUrl,
    organization: organization ?? defaultOrganization,
  });

  const contextLoginSettings = await getLoginSettings({
    serviceUrl,
    organization,
  });

  const identityProviders = await getActiveIdentityProviders({
    serviceUrl,
    orgId: organization ?? defaultOrganization,
  }).then((resp) => {
    return resp.identityProviders;
  });

  return (
    <>
      <h1>
        <Translated i18nKey="title" namespace="loginname" />
      </h1>
      <p className="ztdl-p description">
        <Translated i18nKey="description" namespace="loginname" />
      </p>

      {loginSettings?.allowUsernamePassword && (
        <>
          <UsernameForm
            loginName={loginName}
            requestId={requestId}
            organization={organization} // stick to "organization" as we still want to do user discovery based on the searchParams not the default organization, later the organization is determined by the found user
            loginSettings={contextLoginSettings}
            suffix={suffix}
            submit={submit}
          ></UsernameForm>

          {loginSettings?.allowExternalIdp && !!identityProviders.length && (
            <p className="text-center ztdl-p-secondary or-sign-in-with">
              <Translated i18nKey="orSignInWith" namespace="idp" />
            </p>
          )}
        </>
      )}

      {loginSettings?.allowExternalIdp && !!identityProviders.length && (
        <SignInWithIdp
          identityProviders={identityProviders}
          requestId={requestId}
          organization={organization}
        ></SignInWithIdp>
      )}

      <RegisterBtn organization={organization} requestId={requestId} />
    </>
  );
}
