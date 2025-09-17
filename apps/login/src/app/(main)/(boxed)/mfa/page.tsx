import { Alert } from "@/components/alert";
import { BackButton } from "@/components/back-button";
import { ChooseSecondFactor } from "@/components/choose-second-factor";

import { Translated } from "@/components/translated";
import { UserAvatar } from "@/components/user-avatar";
import { getSessionCookieById } from "@/lib/cookies";
import { generateRouteMetadata } from "@/lib/metadata";
import { getServiceUrlFromHeaders } from "@/lib/service-url";
import { loadMostRecentSession } from "@/lib/session";
import { getSession, listAuthenticationMethodTypes } from "@/lib/zitadel";
import { AuthenticationMethodType } from "@zitadel/proto/zitadel/user/v2/user_service_pb";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const metadata = generateRouteMetadata("mfa");

export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
}) {
  const searchParams = await props.searchParams;

  const { loginName, requestId, organization, sessionId } = searchParams;

  const _headers = await headers();
  const { serviceUrl } = getServiceUrlFromHeaders(_headers);

  const sessionFactors = sessionId
    ? await loadSessionById(serviceUrl, sessionId, organization)
    : await loadSessionByLoginname(serviceUrl, loginName, organization);

  // 2FA-capable methods (exclude PASSWORD, PASSKEY, IDP, UNSPECIFIED)
  const SECOND_FACTOR_METHODS = [
    AuthenticationMethodType.TOTP,
    AuthenticationMethodType.U2F,
    AuthenticationMethodType.OTP_EMAIL,
    AuthenticationMethodType.OTP_SMS,
  ];

  // Skip method selection if only one 2FA method is available
  if (sessionFactors) {
    const validMethods = (sessionFactors.authMethods ?? []).filter((m) =>
      SECOND_FACTOR_METHODS.includes(m),
    );

    if (validMethods.length === 1) {
      const singleMethod = validMethods[0];

      const params = new URLSearchParams();
      if (loginName) params.append("loginName", loginName);
      if (sessionId) params.append("sessionId", sessionId);
      if (requestId) params.append("requestId", requestId);
      if (organization) params.append("organization", organization);

      let target = "";
      switch (singleMethod) {
        case AuthenticationMethodType.TOTP:
          target = "/otp/time-based?" + params.toString();
          break;
        case AuthenticationMethodType.U2F:
          target = "/u2f?" + params.toString();
          break;
        case AuthenticationMethodType.OTP_EMAIL:
          target = "/otp/email?" + params.toString();
          break;
        case AuthenticationMethodType.OTP_SMS:
          target = "/otp/sms?" + params.toString();
          break;
        default:
          break;
      }

      if (target) {
        redirect(target);
      }
    }
  }

  async function loadSessionByLoginname(
    serviceUrl: string,
    loginName?: string,
    organization?: string,
  ) {
    return loadMostRecentSession({
      serviceUrl,
      sessionParams: {
        loginName,
        organization,
      },
    }).then((session) => {
      if (session && session.factors?.user?.id) {
        return listAuthenticationMethodTypes({
          serviceUrl,
          userId: session.factors.user.id,
        }).then((methods) => {
          return {
            factors: session?.factors,
            authMethods: methods.authMethodTypes ?? [],
          };
        });
      }
    });
  }

  async function loadSessionById(
    host: string,
    sessionId: string,
    organization?: string,
  ) {
    const recent = await getSessionCookieById({ sessionId, organization });
    return getSession({
      serviceUrl,
      sessionId: recent.id,
      sessionToken: recent.token,
    }).then((response) => {
      if (response?.session && response.session.factors?.user?.id) {
        return listAuthenticationMethodTypes({
          serviceUrl,
          userId: response.session.factors.user.id,
        }).then((methods) => {
          return {
            factors: response.session?.factors,
            authMethods: methods.authMethodTypes ?? [],
          };
        });
      }
    });
  }

  return (
    <>
      <h1>
        <Translated i18nKey="verify.title" namespace="mfa" />
      </h1>

      <p className="ztdl-p description">
        <Translated i18nKey="verify.description" namespace="mfa" />
      </p>

      {sessionFactors && (
        <div className="mb-10">
          <UserAvatar
            loginName={loginName ?? sessionFactors.factors?.user?.loginName}
            displayName={sessionFactors.factors?.user?.displayName}
            showDropdown
            searchParams={searchParams}
          ></UserAvatar>
        </div>
      )}

      {!(loginName || sessionId) && (
        <Alert>
          <Translated i18nKey="unknownContext" namespace="error" />
        </Alert>
      )}

      {sessionFactors ? (
        <ChooseSecondFactor
          loginName={loginName}
          sessionId={sessionId}
          requestId={requestId}
          organization={organization}
          userMethods={sessionFactors.authMethods ?? []}
        ></ChooseSecondFactor>
      ) : (
        <Alert>
          <Translated i18nKey="verify.noResults" namespace="mfa" />
        </Alert>
      )}

      <div className="flex w-full flex-col items-center justify-center mt-10">
        <BackButton />
      </div>
    </>
  );
}
