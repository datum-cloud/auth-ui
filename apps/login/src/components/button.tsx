import { clsx } from "clsx";
import { ButtonHTMLAttributes, DetailedHTMLProps, forwardRef } from "react";

export enum ButtonSizes {
  Small = "Small",
  Large = "Large",
}

export enum ButtonVariants {
  Primary = "Primary",
  Secondary = "Secondary",
  Destructive = "Destructive",
  Ghost = "Ghost",
  Green = "Green",
}

export enum ButtonColors {
  Neutral = "Neutral",
  Primary = "Primary",
  Warn = "Warn",
}

export type ButtonProps = DetailedHTMLProps<
  ButtonHTMLAttributes<HTMLButtonElement>,
  HTMLButtonElement
> & {
  size?: ButtonSizes;
  variant?: ButtonVariants;
  color?: ButtonColors;
};

export const getButtonClasses = (
  size: ButtonSizes,
  variant: ButtonVariants,
  color: ButtonColors,
) =>
  clsx({
    "box-border font-normal text-button-foreground text-center justify-center leading-36px inline-flex items-center rounded-md focus:outline-none transition-colors transition-shadow duration-300":
      true,
    "bg-button-primary-background text-button-primary-foreground disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 focus:opacity-80 disabled:pointer-events-none transition-all":
      variant === ButtonVariants.Primary,
    "bg-button-ghost-background border-none shadow-none text-button-ghost-foreground underline hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed":
      variant === ButtonVariants.Ghost,
    "border border-button-light-border dark:border-button-dark-border text-gray-950 hover:bg-gray-500 hover:bg-opacity-20 hover:dark:bg-white hover:dark:bg-opacity-10 focus:bg-gray-500 focus:bg-opacity-20 focus:dark:bg-white focus:dark:bg-opacity-10 dark:text-white disabled:text-gray-600 disabled:hover:bg-transparent disabled:dark:hover:bg-transparent disabled:cursor-not-allowed disabled:dark:text-gray-900":
      variant === ButtonVariants.Secondary,
    "border border-button-light-border dark:border-button-dark-border text-warn-light-500 dark:text-warn-dark-500 hover:bg-warn-light-500 hover:bg-opacity-10 dark:hover:bg-warn-light-500 dark:hover:bg-opacity-10 focus:bg-warn-light-500 focus:bg-opacity-20 dark:focus:bg-warn-light-500 dark:focus:bg-opacity-20":
      color === ButtonColors.Warn && variant !== ButtonVariants.Primary,
    "bg-green-dark text-white disabled:opacity-60 disabled:cursor-not-allowed hover:underline disabled:pointer-events-none transition-all":
      variant === ButtonVariants.Green,
    "px-16 py-2": size === ButtonSizes.Large,
    "px-4 py-2": size === ButtonSizes.Small,
  });

// eslint-disable-next-line react/display-name
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className = "",
      variant = ButtonVariants.Primary,
      size = ButtonSizes.Small,
      color = ButtonColors.Primary,
      ...props
    },
    ref,
  ) => (
    <button
      type="button"
      ref={ref}
      className={`${getButtonClasses(size, variant, color)} ${className}`}
      {...props}
    >
      {children}
    </button>
  ),
);
