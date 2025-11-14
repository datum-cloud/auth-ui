"use client";

import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { clsx } from "clsx";
import {
  ChangeEvent,
  DetailedHTMLProps,
  forwardRef,
  InputHTMLAttributes,
  ReactNode,
} from "react";

export type TextInputProps = DetailedHTMLProps<
  InputHTMLAttributes<HTMLInputElement>,
  HTMLInputElement
> & {
  label?: string;
  suffix?: string;
  placeholder?: string;
  defaultValue?: string;
  error?: string | ReactNode;
  success?: string | ReactNode;
  disabled?: boolean;
  onChange?: (value: ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (value: ChangeEvent<HTMLInputElement>) => void;
};

const styles = (error: boolean, disabled: boolean) =>
  clsx({
    "box-border flex flex-row items-center px-4 py-2 w-full bg-input-background border border-input-border rounded-md transition-colors duration-300 opacity-100":
      true,
    "focus:outline-none focus:ring-0 focus:border-input-focus focus:!shadow-[0_0_0_2px_rgba(77,99,86,0.15)] text-input-foreground placeholder:text-input-foreground placeholder:opacity-60":
      true,
    "border-warn-light-500 dark:border-warn-dark-500 hover:border-warn-light-500 hover:dark:border-warn-dark-500 focus:border-warn-light-500 focus:dark:border-warn-dark-500":
      error,
    "pointer-events-none opacity-50 cursor-default": disabled,
  });

// eslint-disable-next-line react/display-name
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  (
    {
      label,
      placeholder,
      defaultValue,
      suffix,
      required = false,
      error,
      disabled,
      success,
      onChange,
      onBlur,
      ...props
    },
    ref,
  ) => {
    return (
      <label className="relative flex flex-col text-input-light-label dark:text-input-dark-label">
        {label && (
          <span
            className={`leading-3 mb-1 ${
              error ? "text-warn-light-500 dark:text-warn-dark-500" : ""
            }`}
          >
            {label} {required && "*"}
          </span>
        )}
        <input
          suppressHydrationWarning
          ref={ref}
          className={styles(!!error, !!disabled)}
          defaultValue={defaultValue}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={props.autoComplete ?? "off"}
          onChange={(e) => onChange && onChange(e)}
          onBlur={(e) => onBlur && onBlur(e)}
          {...props}
        />

        {suffix && (
          <span className="z-30 absolute right-[3px] bottom-[22px] transform translate-y-1/2 bg-background-light-500 dark:bg-background-dark-500 p-2 rounded-sm">
            @{suffix}
          </span>
        )}

        <div className="leading-14.5px h-14.5px text-warn-light-500 dark:text-warn-dark-500 flex flex-row items-center text-12px">
          <span>{error ? error : " "}</span>
        </div>

        {success && (
          <div className="text-md mt-1 flex flex-row items-center text-green-500">
            <CheckCircleIcon className="h-4 w-4" />
            <span className="ml-1">{success}</span>
          </div>
        )}
      </label>
    );
  },
);
