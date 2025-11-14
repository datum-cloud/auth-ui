"use client";

import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import { ButtonHTMLAttributes, DetailedHTMLProps, forwardRef } from "react";
import { useFormStatus } from "react-dom";

export type SignInWithIdentityProviderProps = DetailedHTMLProps<
  ButtonHTMLAttributes<HTMLButtonElement>,
  HTMLButtonElement
> & {
  name?: string;
  e2e?: string;
  containerclassname?: string;
};

export const BaseButton = forwardRef<
  HTMLButtonElement,
  SignInWithIdentityProviderProps
>(function BaseButton(props, ref) {
  const formStatus = useFormStatus();

  return (
    <button
      {...props}
      type="submit"
      ref={ref}
      disabled={formStatus.pending}
      className={clsx(
        "flex-1 transition-all cursor-pointer flex flex-row items-center bg-button-idp-background text-button-idp-foreground border border-button-idp-border hover:border-button-idp-focus focus:border-button-idp-focus outline-none rounded-md px-4 text-sm",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
        "h-[58px] text-[19px]",
        props.className,
      )}
    >
      <div className="flex-1 justify-between flex items-center gap-4 relative">
        <div
          className={clsx(
            "flex-1 flex flex-row items-center",
            props.containerclassname,
          )}
        >
          {props.children}
        </div>
        {formStatus.pending && (
          <div className="absolute right-2">
            <Loader2 className="w-6 h-6 animate-spin stroke-loader-color" />
          </div>
        )}
      </div>
    </button>
  );
});
