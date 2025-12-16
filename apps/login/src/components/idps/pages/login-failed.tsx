import { Alert, AlertType } from "../../alert";
import { Translated } from "../../translated";

export async function loginFailed(error?: string) {
  return (
    <>
      <h1>
        <Translated i18nKey="loginError.title" namespace="idp" />
      </h1>
      <p className="ztdl-p">
        <Translated i18nKey="loginError.description" namespace="idp" />
      </p>
      {error && (
        <div className="py-4 w-full">
          {<Alert type={AlertType.ALERT}>{error}</Alert>}
        </div>
      )}
    </>
  );
}
