import { IdpSignin } from "@/components/idp-signin";
import { completeIDP } from "@/components/idps/pages/complete-idp";
import { linkingFailed } from "@/components/idps/pages/linking-failed";
import { linkingSuccess } from "@/components/idps/pages/linking-success";
import { loginFailed } from "@/components/idps/pages/login-failed";
import { loginSuccess } from "@/components/idps/pages/login-success";
import { Translated } from "@/components/translated";
import { generateRouteMetadata } from "@/lib/metadata";
import { getServiceUrlFromHeaders } from "@/lib/service-url";
import {
  addHuman,
  addIDPLink,
  getDefaultOrg,
  getIDPByID,
  getLoginSettings,
  getOrgsByDomain,
  listUsers,
  retrieveIDPIntent,
  updateHuman,
} from "@/lib/zitadel";
import { ConnectError, create } from "@zitadel/client";
import { AutoLinkingOption } from "@zitadel/proto/zitadel/idp/v2/idp_pb";
import { OrganizationSchema } from "@zitadel/proto/zitadel/object/v2/object_pb";
import { Organization } from "@zitadel/proto/zitadel/org/v2/org_pb";
import { SetHumanEmailSchema } from "@zitadel/proto/zitadel/user/v2/email_pb";
import {
  AddHumanUserRequest,
  AddHumanUserRequestSchema,
  UpdateHumanUserRequestSchema,
} from "@zitadel/proto/zitadel/user/v2/user_service_pb";
import { headers } from "next/headers";

const ORG_SUFFIX_REGEX = /(?<=@)(.+)/;

async function resolveOrganizationForUser({
  organization,
  addHumanUser,
  serviceUrl,
}: {
  organization?: string;
  addHumanUser?: { username?: string };
  serviceUrl: string;
}): Promise<string | undefined> {
  if (organization) return organization;

  if (addHumanUser?.username && ORG_SUFFIX_REGEX.test(addHumanUser.username)) {
    const matched = ORG_SUFFIX_REGEX.exec(addHumanUser.username);
    const suffix = matched?.[1] ?? "";

    const orgs = await getOrgsByDomain({
      serviceUrl,
      domain: suffix,
    });
    const orgToCheckForDiscovery =
      orgs.result && orgs.result.length === 1 ? orgs.result[0].id : undefined;

    if (orgToCheckForDiscovery) {
      const orgLoginSettings = await getLoginSettings({
        serviceUrl,
        organization: orgToCheckForDiscovery,
      });
      if (orgLoginSettings?.allowDomainDiscovery) {
        return orgToCheckForDiscovery;
      }
    }
  }
  return undefined;
}

type GithubEmailInfo = { email: string; verified: boolean } | undefined;

// getGithubPrimaryEmail fetches the primary email, even if the user has hidden it
// user:email scope is required for private emails
async function getGithubPrimaryEmail(token: string): Promise<GithubEmailInfo> {
  const fetchEmails = async () => {
    return fetch("https://api.github.com/user/emails", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
  };

  try {
    let res = await fetchEmails();
    if (!res.ok) {
      console.warn("GitHub email fetch failed", res.status);
      return undefined;
    }

    const data: Array<{ email: string; primary: boolean; verified: boolean }> =
      await res.json();

    const primary =
      data.find((e) => e.primary && e.verified) ||
      data.find((e) => e.primary) ||
      data[0];
    if (primary) {
      return { email: primary.email, verified: primary.verified };
    }

    return undefined;
  } catch (err) {
    console.warn("GitHub email fetch error", err);
    return undefined;
  }
}

export const metadata = generateRouteMetadata("idp");
export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
  params: Promise<{ provider: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  let { id, token, requestId, organization, link } = searchParams;
  const { provider } = params;

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

  if (!provider || !id || !token) {
    return loginFailed("IDP context missing");
  }

  const intent = await retrieveIDPIntent({
    serviceUrl,
    id,
    token,
  });

  const { idpInformation, userId } = intent;
  let { addHumanUser } = intent;

  // ensure mandatory profile fields are populated to satisfy ZITADEL validation, as GitHub does not provide givenName
  // and familyName
  if (addHumanUser) {
    const profile: any = addHumanUser.profile ?? {};
    let { givenName, familyName } = profile;

    const fallback = idpInformation?.userName ?? "user";

    // if givenName or familyName is not set, try to derive it from the displayName
    if (!givenName || !familyName) {
      if (addHumanUser.profile?.displayName) {
        const source = addHumanUser.profile.displayName.trim();
        const parts = source.split(/\s+/);
        if (parts.length >= 2) {
          const derivedFamily = parts.pop()!.slice(0, 200);
          const derivedGiven = parts.join(" ").slice(0, 200);
          givenName = derivedGiven;
          familyName = derivedFamily;
        }
      }
    }

    if (!givenName || givenName.trim().length === 0) {
      givenName = fallback.slice(0, 200);
    }

    if (!familyName || familyName.trim().length === 0) {
      familyName = fallback.slice(0, 200);
    }

    addHumanUser = {
      ...addHumanUser,
      profile: {
        ...profile,
        givenName,
        familyName,
      },
    } as typeof addHumanUser;

    // ensure email exists as well (GitHub may not return an address if user hides it)
    if (
      !addHumanUser.email?.email ||
      addHumanUser.email.email.trim().length === 0
    ) {
      let newEmailInfo: GithubEmailInfo;
      const githubAccessToken: string | undefined = (idpInformation as any)
        ?.access?.value?.accessToken;
      if (provider === "github") {
        if (githubAccessToken) {
          newEmailInfo = await getGithubPrimaryEmail(githubAccessToken);
        }
      }
      let finalEmail = newEmailInfo?.email ?? `${fallback}@idp.local`;
      const isVerified = newEmailInfo?.verified ?? false;

      addHumanUser = {
        ...addHumanUser,
        email: create(SetHumanEmailSchema, {
          email: finalEmail.slice(0, 200),
          verification: { case: "isVerified", value: isVerified },
        }),
      };
    }
  }

  if (!idpInformation) {
    return loginFailed("IDP information missing");
  }

  const idp = await getIDPByID({
    serviceUrl,
    id: idpInformation.idpId,
  });

  const options = idp?.config?.options;

  if (!idp) {
    throw new Error("IDP not found");
  }

  // sign in user. If user should be linked continue
  if (userId && !link) {
    // if auto update is enabled, we will update the user with the new information
    if (options?.isAutoUpdate && addHumanUser) {
      try {
        await updateHuman({
          serviceUrl,
          request: create(UpdateHumanUserRequestSchema, {
            userId: userId,
            profile: addHumanUser.profile,
            email: addHumanUser.email,
            phone: addHumanUser.phone,
          }),
        });
      } catch (error: unknown) {
        // Log the error and continue with the login process
        console.warn("An error occurred while updating the user:", error);
      }
    }

    return loginSuccess(
      userId,
      { idpIntentId: id, idpIntentToken: token },
      requestId,
    );
  }

  if (link) {
    if (!options?.isLinkingAllowed) {
      // linking was probably disallowed since the invitation was created
      return linkingFailed("Linking is no longer allowed");
    }

    let idpLink;
    try {
      idpLink = await addIDPLink({
        serviceUrl,
        idp: {
          id: idpInformation.idpId,
          userId: idpInformation.userId,
          userName: idpInformation.userName,
        },
        userId,
      });
    } catch (error) {
      console.error(error);
      return linkingFailed();
    }

    if (!idpLink) {
      return linkingFailed();
    } else {
      return linkingSuccess(
        userId,
        { idpIntentId: id, idpIntentToken: token },
        requestId,
      );
    }
  }

  // search for potential user via username, then link
  if (options?.autoLinking) {
    let foundUser;
    const email = addHumanUser?.email?.email;

    if (options.autoLinking === AutoLinkingOption.EMAIL && email) {
      foundUser = await listUsers({ serviceUrl, email }).then((response) => {
        return response.result ? response.result[0] : null;
      });
    } else if (options.autoLinking === AutoLinkingOption.USERNAME) {
      foundUser = await listUsers(
        options.autoLinking === AutoLinkingOption.USERNAME
          ? { serviceUrl, userName: idpInformation.userName }
          : { serviceUrl, email },
      ).then((response) => {
        return response.result ? response.result[0] : null;
      });
    } else {
      foundUser = await listUsers({
        serviceUrl,
        userName: idpInformation.userName,
        email,
      }).then((response) => {
        return response.result ? response.result[0] : null;
      });
    }

    if (foundUser) {
      let idpLink;
      try {
        idpLink = await addIDPLink({
          serviceUrl,
          idp: {
            id: idpInformation.idpId,
            userId: idpInformation.userId,
            userName: idpInformation.userName,
          },
          userId: foundUser.userId,
        });
      } catch (error) {
        console.error(error);
        return linkingFailed();
      }

      if (!idpLink) {
        return linkingFailed();
      } else {
        return linkingSuccess(
          foundUser.userId,
          { idpIntentId: id, idpIntentToken: token },
          requestId,
        );
      }
    }
  }

  let newUser;
  // automatic creation of a user is allowed and data is complete
  if (options?.isAutoCreation && addHumanUser) {
    const orgToRegisterOn = await resolveOrganizationForUser({
      organization,
      addHumanUser,
      serviceUrl,
    });

    let addHumanUserWithOrganization: AddHumanUserRequest;
    if (orgToRegisterOn) {
      const organizationSchema = create(OrganizationSchema, {
        org: { case: "orgId", value: orgToRegisterOn },
      });

      addHumanUserWithOrganization = create(AddHumanUserRequestSchema, {
        ...addHumanUser,
        organization: organizationSchema,
      });
    } else {
      addHumanUserWithOrganization = create(
        AddHumanUserRequestSchema,
        addHumanUser,
      );
    }

    try {
      newUser = await addHuman({
        serviceUrl,
        request: addHumanUserWithOrganization,
      });
    } catch (error: unknown) {
      console.error(
        "An error occurred while creating the user:",
        error,
        addHumanUser,
      );
      return loginFailed(
        (error as ConnectError).message
          ? (error as ConnectError).message
          : "Could not create user",
      );
    }
  } else if (options?.isCreationAllowed) {
    // if no user was found, we will create a new user manually / redirect to the registration page
    const orgToRegisterOn = await resolveOrganizationForUser({
      organization,
      addHumanUser,
      serviceUrl,
    });

    if (!orgToRegisterOn) {
      return loginFailed("No organization found for registration");
    }

    return completeIDP({
      idpIntent: { idpIntentId: id, idpIntentToken: token },
      addHumanUser,
      organization: orgToRegisterOn,
      requestId,
      idpUserId: idpInformation?.userId,
      idpId: idpInformation?.idpId,
      idpUserName: idpInformation?.userName,
    });
  }

  if (newUser) {
    return (
      <>
        <h1>
          <Translated i18nKey="registerSuccess.title" namespace="idp" />
        </h1>
        <p className="ztdl-p">
          <Translated i18nKey="registerSuccess.description" namespace="idp" />
        </p>
        <IdpSignin
          userId={newUser.userId}
          idpIntent={{ idpIntentId: id, idpIntentToken: token }}
          requestId={requestId}
        />
      </>
    );
  }

  // return login failed if no linking or creation is allowed and no user was found
  return loginFailed("No user found");
}
