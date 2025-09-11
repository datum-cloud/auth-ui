import clsx from "clsx";
import { ReactNode } from "react";
import { DatumLogoFull } from "./datum-logo/full";

export const BoxedCard = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div className="flex flex-col items-center justify-center gap-[60px] w-full">
      <DatumLogoFull className="h-[86px]" />
      <div
        className={clsx(
          "boxed-card",
          "rounded border border-dark-navy-blue dark:border-cream bg-white dark:bg-dark-navy-blue p-[70px] w-full max-w-[528px]",
          "flex flex-col items-center",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
};
