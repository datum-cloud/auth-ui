import { Alert } from "@/components/alert";
import { RegisterForm } from "@/components/register-form";
import { SignInWithIdp } from "@/components/sign-in-with-idp";
import { Translated } from "@/components/translated";
import { generateRouteMetadata } from "@/lib/metadata";
import { getServiceUrlFromHeaders } from "@/lib/service-url";
import {
  getActiveIdentityProviders,
  getDefaultOrg,
  getLoginSettings,
  getPasswordComplexitySettings,
} from "@/lib/zitadel";
import { Organization } from "@zitadel/proto/zitadel/org/v2/org_pb";
import { PasskeysType } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb";
import { headers } from "next/headers";
import { LoginBtn } from "./_login-btn";

export const metadata = generateRouteMetadata("register");

export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
}) {
  const searchParams = await props.searchParams;

  let { firstname, lastname, email, organization, requestId } = searchParams;

  const _headers = await headers();
  const { serviceUrl } = getServiceUrlFromHeaders(_headers);

  if (!organization) {
    const org: Organization | null = await getDefaultOrg({
      serviceUrl,
    });
    if (org) {
      organization = org.id;
    }
  }

  const passwordComplexitySettings = await getPasswordComplexitySettings({
    serviceUrl,
    organization,
  });

  const loginSettings = await getLoginSettings({
    serviceUrl,
    organization,
  });

  const identityProviders = await getActiveIdentityProviders({
    serviceUrl,
    orgId: organization,
  }).then((resp) => {
    return resp.identityProviders.filter((idp) => {
      return idp.options?.isAutoCreation || idp.options?.isCreationAllowed; // check if IDP allows to create account automatically or manual creation is allowed
    });
  });

  return (
    <>
      <h1>
        <Translated i18nKey="title" namespace="register" />
      </h1>
      <p className="ztdl-p description">
        <Translated i18nKey="description" namespace="register" />
      </p>

      {!organization && (
        <Alert>
          <Translated i18nKey="unknownContext" namespace="error" />
        </Alert>
      )}

      {loginSettings?.allowRegister &&
        passwordComplexitySettings &&
        organization &&
        (loginSettings.allowUsernamePassword ||
          loginSettings.passkeysType == PasskeysType.ALLOWED) && (
          <>
            <RegisterForm
              idpCount={
                !loginSettings?.allowExternalIdp ? 0 : identityProviders.length
              }
              organization={organization}
              firstname={firstname}
              lastname={lastname}
              email={email}
              requestId={requestId}
              loginSettings={loginSettings}
            ></RegisterForm>
            {loginSettings?.allowExternalIdp && !!identityProviders.length && (
              <p className="text-center ztdl-p-secondary or-sign-in-with">
                <Translated i18nKey="orUseIDP" namespace="register" />
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

      <p className="text-center ztdl-p-secondary terms-of-service">
        <Translated
          i18nKey="termsOfService"
          namespace="loginname"
          useCommonTags
        />
      </p>

      <LoginBtn />
    </>
  );
}
