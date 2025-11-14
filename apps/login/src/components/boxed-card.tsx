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
    <div className="flex flex-col items-center justify-center gap-[60px] w-full z-10">
      <DatumLogoFull className="h-[86px]" />
      <div
        className={clsx(
          "boxed-card",
          "rounded border border-card-border bg-card-background p-[70px] w-full max-w-[528px]",
          "flex flex-col items-center",
          className,
        )}
      >
        {children}
      </div>

      <div className="mb-[70px] w-full max-w-[528px]">
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
