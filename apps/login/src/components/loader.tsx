import { Loader2 } from "lucide-react";
import { DatumLogo } from "./datum-logo/logo";

export const Loader = () => {
  return (
    <div className="flex min-h-screen w-full items-center justify-center gap-6 flex-col">
      <DatumLogo width={48} height={48} />
      <Loader2 className="animate-spin size-8 stroke-loader-color" />
    </div>
  );
};
