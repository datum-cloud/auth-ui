import clsx from "clsx";
import { ReactNode } from "react";
import { DatumLogoFull } from "./datum-logo/full";
import { Translated } from "./translated";

export const BoxedCard = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div className="flex flex-col items-center gap-[50px] w-full z-10 p-[90px]">
      <DatumLogoFull className="h-[86px]" />
      <div
        className={clsx(
          "boxed-card",
          "rounded border border-card-border bg-card-background p-[50px] w-full max-w-[400px]",
          "flex flex-col items-center",
          className,
        )}
      >
        {children}
      </div>

      <div className="w-full max-w-[250px]">
        <p className="text-center ztdl-p-secondary terms-of-service">
          <Translated
            i18nKey="termsOfService"
            namespace="loginname"
            useCommonTags
          />
        </p>
      </div>
    </div>
  );
};
