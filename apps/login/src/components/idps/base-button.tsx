"use client";

import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import { ButtonHTMLAttributes, DetailedHTMLProps, forwardRef } from "react";
import { useFormStatus } from "react-dom";
import { Translated } from "../translated";

export type SignInWithIdentityProviderProps = DetailedHTMLProps<
  ButtonHTMLAttributes<HTMLButtonElement>,
  HTMLButtonElement
> & {
  name?: string;
  e2e?: string;
  containerclassname?: string;
  isLastUsed?: boolean;
};

export const BaseButton = forwardRef<
  HTMLButtonElement,
  SignInWithIdentityProviderProps
>(function BaseButton(props, ref) {
  const formStatus = useFormStatus();
  const {
    isLastUsed,
    containerclassname,
    e2e,
    ...buttonProps
  } = props;

  return (
    <button
      {...buttonProps}
      data-testid={e2e}
      type="submit"
      ref={ref}
      disabled={formStatus.pending}
      className={clsx(
        "flex-1 transition-all cursor-pointer flex flex-row items-center bg-button-idp-background text-button-idp-foreground border border-button-idp-border hover:border-button-idp-focus focus:border-button-idp-focus outline-none rounded-md px-4 py-2 text-[16px]",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
        props.className,
      )}
    >
      <div className="flex-1 justify-between flex items-center gap-4 relative">
        <div
          className={clsx(
            "flex-1 flex flex-row items-center relative",
            containerclassname,
          )}
        >
          {props.children}
          {isLastUsed && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-button-primary-foreground shrink-0 absolute -right-10 -top-4 bg-button-primary-background">
              <Translated i18nKey="lastUsed" namespace="idp" />
            </span>
          )}
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
