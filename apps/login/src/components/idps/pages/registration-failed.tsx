import { ReactNode } from "react";
import { Alert, AlertType } from "../../alert";
import { Translated } from "../../translated";

export async function registrationFailed(error?: string | ReactNode) {
  return (
    <>
      <h1>
        <Translated i18nKey="registerError.title" namespace="idp" />
      </h1>
      <p className="ztdl-p mb-4">
        <Translated i18nKey="registerError.description" namespace="idp" />
      </p>
      {error && (
        <div className="w-full">
          {<Alert type={AlertType.ALERT}>{error}</Alert>}
        </div>
      )}
    </>
  );
}
