"use server";

import {
  getLoginSettings,
  getSession,
  getUserByID,
  listAuthenticationMethodTypes,
  removeIDPLink,
  startIdentityProviderFlow,
  startLDAPIdentityProviderFlow,
} from "@/lib/zitadel";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getNextUrl } from "../client";
import { getMostRecentSessionCookie } from "../cookies";
import { getServiceUrlFromHeaders } from "../service-url";
import { checkEmailVerification, checkMFAFactors } from "../verify-helper";
import { createSessionForIdpAndUpdateCookie } from "./cookie";

export type RedirectToIdpState = { error?: string | null } | undefined;

export async function redirectToIdp(
  prevState: RedirectToIdpState,
  formData: FormData,
): Promise<RedirectToIdpState> {
  const _headers = await headers();
  const { serviceUrl } = getServiceUrlFromHeaders(_headers);
  const host = _headers.get("host");
  if (!host) {
    return { error: "Could not get host" };
  }

  const params = new URLSearchParams();

  const linkOnly = formData.get("linkOnly") === "true";
  const requestId = formData.get("requestId") as string;
  const organization = formData.get("organization") as string;
  const userId = formData.get("userId") as string;
  const onSuccessRedirectTo = formData.get("onSuccessRedirectTo") as string;
  const idpId = formData.get("id") as string;
  const provider = formData.get("provider") as string;
  const preventCreation = formData.get("preventCreation") === "true";

  if (linkOnly) params.set("link", "true");
  if (requestId) params.set("requestId", requestId);
  if (organization) params.set("organization", organization);
  if (onSuccessRedirectTo)
    params.set("onSuccessRedirectTo", onSuccessRedirectTo);
  if (userId) params.set("userId", userId);
  if (preventCreation) params.set("preventCreation", "true");

  // redirect to LDAP page where username and password is requested
  if (provider === "ldap") {
    params.set("idpId", idpId);
    redirect(`/idp/ldap?` + params.toString());
  }

  const response = await startIDPFlow({
    serviceUrl,
    host,
    idpId,
    successUrl: `/idp/${provider}/success?` + params.toString(),
    failureUrl: `/idp/${provider}/failure?` + params.toString(),
  });

  if (!response) {
    return { error: "Could not start IDP flow" };
  }

  if (response && "redirect" in response && response?.redirect) {
    redirect(response.redirect);
  }

  return { error: "Unexpected response from IDP flow" };
}

export type StartIDPFlowCommand = {
  serviceUrl: string;
  host: string;
  idpId: string;
  successUrl: string;
  failureUrl: string;
};

async function startIDPFlow(command: StartIDPFlowCommand) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  const url = await startIdentityProviderFlow({
    serviceUrl: command.serviceUrl,
    idpId: command.idpId,
    urls: {
      successUrl: `${command.host.includes("localhost") ? "http://" : "https://"}${command.host}${basePath}${command.successUrl}`,
      failureUrl: `${command.host.includes("localhost") ? "http://" : "https://"}${command.host}${basePath}${command.failureUrl}`,
    },
  });

  if (!url) {
    return { error: "Could not start IDP flow" };
  }

  return { redirect: url };
}

type CreateNewSessionCommand = {
  userId: string;
  idpIntent: {
    idpIntentId: string;
    idpIntentToken: string;
  };
  loginName?: string;
  password?: string;
  organization?: string;
  requestId?: string;
};

export async function createNewSessionFromIdpIntent(
  command: CreateNewSessionCommand,
) {
  const _headers = await headers();

  const { serviceUrl } = getServiceUrlFromHeaders(_headers);
  const host = _headers.get("host");

  if (!host) {
    return { error: "Could not get domain" };
  }

  if (!command.userId || !command.idpIntent) {
    throw new Error("No userId or loginName provided");
  }

  const userResponse = await getUserByID({
    serviceUrl,
    userId: command.userId,
  });

  if (!userResponse || !userResponse.user) {
    return { error: "User not found in the system" };
  }

  const loginSettings = await getLoginSettings({
    serviceUrl,
    organization: userResponse.user.details?.resourceOwner,
  });

  const session = await createSessionForIdpAndUpdateCookie({
    userId: command.userId,
    idpIntent: command.idpIntent,
    requestId: command.requestId,
    lifetime: loginSettings?.externalLoginCheckLifetime,
  });

  if (!session || !session.factors?.user) {
    return { error: "Could not create session" };
  }

  const humanUser =
    userResponse.user.type.case === "human"
      ? userResponse.user.type.value
      : undefined;

  // check to see if user was verified
  const emailVerificationCheck = checkEmailVerification(
    session,
    humanUser,
    command.organization,
    command.requestId,
  );

  if (emailVerificationCheck?.redirect) {
    return emailVerificationCheck;
  }

  // check if user has MFA methods or needs to enroll new ones
  let authMethods;
  try {
    const response = await listAuthenticationMethodTypes({
      serviceUrl,
      userId: session.factors.user.id,
    });
    if (response.authMethodTypes && response.authMethodTypes.length) {
      authMethods = response.authMethodTypes;
    }
  } catch (error) {
    console.warn("Could not load authentication methods", error);
  }

  const mfaFactorCheck = await checkMFAFactors(
    serviceUrl,
    session,
    loginSettings,
    authMethods ?? [],
    command.organization,
    command.requestId,
  );
  if (mfaFactorCheck?.redirect) {
    return mfaFactorCheck;
  }

  const url = await getNextUrl(
    command.requestId && session.id
      ? {
          sessionId: session.id,
          requestId: command.requestId,
          organization: session.factors.user.organizationId,
        }
      : {
          loginName: session.factors.user.loginName,
          organization: session.factors.user.organizationId,
        },
    loginSettings?.defaultRedirectUri,
  );

  if (url) {
    return { redirect: url };
  }
}

type createNewSessionForLDAPCommand = {
  username: string;
  password: string;
  idpId: string;
  link: boolean;
};

export async function createNewSessionForLDAP(
  command: createNewSessionForLDAPCommand,
) {
  const _headers = await headers();

  const { serviceUrl } = getServiceUrlFromHeaders(_headers);
  const host = _headers.get("host");

  if (!host) {
    return { error: "Could not get domain" };
  }

  if (!command.username || !command.password) {
    return { error: "No username or password provided" };
  }

  const response = await startLDAPIdentityProviderFlow({
    serviceUrl,
    idpId: command.idpId,
    username: command.username,
    password: command.password,
  });

  if (
    !response ||
    response.nextStep.case !== "idpIntent" ||
    !response.nextStep.value
  ) {
    return { error: "Could not start LDAP identity provider flow" };
  }

  const { userId, idpIntentId, idpIntentToken } = response.nextStep.value;

  const params = new URLSearchParams({
    userId,
    id: idpIntentId,
    token: idpIntentToken,
  });

  if (command.link) {
    params.set("link", "true");
  }

  return {
    redirect: `/idp/ldap/success?` + params.toString(),
  };
}

export async function unlinkIdp(formData: FormData) {
  if (process.env.ALLOW_IDP_UNLINK !== "true") {
    console.warn("Attempt to unlink IDP while feature is disabled");
    return;
  }

  const _headers = await headers();
  const { serviceUrl } = getServiceUrlFromHeaders(_headers);

  const idpId = formData.get("idpId") as string;
  const linkedUserId = formData.get("linkedUserId") as string;

  if (!idpId || !linkedUserId) {
    return;
  }

  // Securely get the user ID from the active session
  let userId: string;
  try {
    const recentCookie = await getMostRecentSessionCookie();
    const { session } = await getSession({
      serviceUrl,
      sessionId: recentCookie.id,
      sessionToken: recentCookie.token,
    });

    if (!session || !session.factors?.user?.id) {
      throw new Error("No active session found");
    }
    userId = session.factors.user.id;
  } catch (error) {
    console.error(
      "Security violation: Attempt to unlink IDP without valid session",
      error,
    );
    return;
  }

  try {
    await removeIDPLink({
      serviceUrl,
      userId,
      idpId,
      linkedUserId,
    });
    revalidatePath("/idp/link");
  } catch (error) {
    console.error("Could not unlink IDP", error);
  }
}
