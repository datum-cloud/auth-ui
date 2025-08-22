import Link from "next/link";
import { ReactNode } from "react";

// Common rich text tags that can be reused across the app
type CommonTag = "terms" | "privacy" | "b" | "i" | "br" | "link";

interface RichTextProps {
  children: (
    tags: Record<CommonTag, (chunks: ReactNode) => ReactNode>,
  ) => ReactNode;
  className?: string;
}

export function RichText({ children, className }: RichTextProps) {
  const commonTags: Record<CommonTag, (chunks: ReactNode) => ReactNode> = {
    // Legal links
    terms: (chunks: ReactNode) => (
      <Link
        href="https://www.datum.net/terms-of-service"
        target="_blank"
        rel="noopener noreferrer"
        className="underline "
      >
        {chunks}
      </Link>
    ),
    privacy: (chunks: ReactNode) => (
      <Link
        href="https://www.datum.net/privacy-policy"
        target="_blank"
        rel="noopener noreferrer"
        className="underline "
      >
        {chunks}
      </Link>
    ),

    // Text formatting
    b: (chunks: ReactNode) => (
      <strong className="font-semibold">{chunks}</strong>
    ),
    i: (chunks: ReactNode) => <em className="italic">{chunks}</em>,

    // Line break
    br: () => <br />,

    // Generic link (requires href to be passed separately)
    link: (chunks: ReactNode) => (
      <span className="text-blue-600 hover:text-blue-800 underline cursor-pointer">
        {chunks}
      </span>
    ),
  };

  return <span className={className}>{children(commonTags)}</span>;
}
