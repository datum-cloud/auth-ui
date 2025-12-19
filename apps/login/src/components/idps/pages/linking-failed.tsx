import { ReactNode } from "react";
import { Alert, AlertType } from "../../alert";
import { Translated } from "../../translated";

export async function linkingFailed(error?: ReactNode) {
  return (
    <>
      <h1>
        <Translated i18nKey="linkingError.title" namespace="idp" />
      </h1>
      <p className="ztdl-p">
        <Translated i18nKey="linkingError.description" namespace="idp" />
      </p>
      {error && (
        <div className="mt-4 w-full">
          {<Alert type={AlertType.ALERT}>{error}</Alert>}
        </div>
      )}
    </>
  );
}
