import { IdpSignin } from "../../idp-signin";
import { Translated } from "../../translated";

export async function linkingSuccess(
  userId: string,
  idpIntent: { idpIntentId: string; idpIntentToken: string },
  requestId?: string,
) {
  return (
    <>
      <h1>
        <Translated i18nKey="linkingSuccess.title" namespace="idp" />
      </h1>
      <p className="ztdl-p">
        <Translated i18nKey="linkingSuccess.description" namespace="idp" />
      </p>

      <IdpSignin userId={userId} idpIntent={idpIntent} requestId={requestId} />
    </>
  );
}
