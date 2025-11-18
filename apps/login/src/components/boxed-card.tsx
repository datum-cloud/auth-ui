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
    <div className="flex flex-col items-center gap-4 sm:gap-6 md:gap-8 lg:gap-[50px] w-full z-10 p-3 sm:p-4 md:p-6 lg:p-12 xl:p-[90px] min-w-0">
      <DatumLogoFull className="h-10 sm:h-12 md:h-16 lg:h-[86px] w-auto" />
      <div
        className={clsx(
          "boxed-card",
          "rounded border border-card-border bg-card-background p-3 sm:p-4 md:p-6 lg:p-8 xl:p-[50px] w-full max-w-full sm:max-w-[400px]",
          "flex flex-col items-center min-w-0",
          className,
        )}
      >
        {children}
      </div>

      <div className="w-full max-w-full sm:max-w-[250px] px-3 sm:px-4 md:px-0">
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
