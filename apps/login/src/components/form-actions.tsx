"use client";

import { Loader2 } from "lucide-react";
import { ReactNode } from "react";
import { BackButton } from "./back-button";
import { Button, ButtonVariants } from "./button";

export interface FormActionsProps {
  /** Submit button label */
  submitLabel: ReactNode;
  /** Whether the submit button is disabled */
  disabled?: boolean;
  /** Whether to show loading spinner */
  loading?: boolean;
  /** Submit button click handler */
  onSubmit?: () => void;
  /** Whether to show the back button */
  showBackButton?: boolean;
  /** Additional CSS classes for the container */
  className?: string;
  /** Submit button test id */
  submitTestId?: string;
  /** Back button test id */
  backTestId?: string;
}

export function FormActions({
  submitLabel,
  disabled = false,
  loading = false,
  onSubmit,
  showBackButton = true,
  className = "",
  submitTestId = "submit-button",
  backTestId = "back-button",
}: FormActionsProps) {
  return (
    <div
      className={`flex w-full flex-col items-center gap-2 justify-center ${className}`}
    >
      <Button
        data-testid={submitTestId}
        type="submit"
        className="w-full h-[62px] !text-[19px]"
        variant={ButtonVariants.Green}
        disabled={disabled}
        onClick={onSubmit}
      >
        {loading ? (
          <Loader2 className="h-6 w-6 animate-spin stroke-green-dark dark:stroke-cream" />
        ) : (
          submitLabel
        )}
      </Button>
      {showBackButton && <BackButton data-testid={backTestId} />}
    </div>
  );
}
