import { RegisterFormIDPIncomplete } from "@/components/register-form-idp-incomplete";
import { AddHumanUserRequest } from "@zitadel/proto/zitadel/user/v2/user_service_pb";
import { Translated } from "../../translated";

export async function completeIDP({
  idpUserId,
  idpId,
  idpUserName,
  addHumanUser,
  requestId,
  organization,
  idpIntent,
}: {
  idpUserId: string;
  idpId: string;
  idpUserName: string;
  addHumanUser?: AddHumanUserRequest;
  requestId?: string;
  organization: string;
  idpIntent: {
    idpIntentId: string;
    idpIntentToken: string;
  };
}) {
  return (
    <>
      <h1>
        <Translated i18nKey="completeRegister.title" namespace="idp" />
      </h1>
      <p className="ztdl-p">
        <Translated i18nKey="completeRegister.description" namespace="idp" />
      </p>

      <RegisterFormIDPIncomplete
        idpUserId={idpUserId}
        idpId={idpId}
        idpUserName={idpUserName}
        defaultValues={{
          email: addHumanUser?.email?.email || "",
          firstname: addHumanUser?.profile?.givenName || "",
          lastname: addHumanUser?.profile?.familyName || "",
        }}
        requestId={requestId}
        organization={organization}
        idpIntent={idpIntent}
      />
    </>
  );
}
