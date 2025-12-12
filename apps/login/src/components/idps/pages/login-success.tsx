import { IdpSignin } from "../../idp-signin";
import { Translated } from "../../translated";

export async function loginSuccess(
  userId: string,
  idpIntent: { idpIntentId: string; idpIntentToken: string },
  requestId?: string,
  onSuccessRedirectTo?: string,
) {
  return (
    <>
      <h1>
        <Translated i18nKey="loginSuccess.title" namespace="idp" />
      </h1>
      <p className="ztdl-p">
        <Translated i18nKey="loginSuccess.description" namespace="idp" />
      </p>

      <IdpSignin
        userId={userId}
        idpIntent={idpIntent}
        requestId={requestId}
        onSuccessRedirectTo={onSuccessRedirectTo}
      />
    </>
  );
}
