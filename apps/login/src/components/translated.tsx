import { useTranslations } from "next-intl";
import { ReactNode } from "react";
import { RichText } from "./rich-text";

interface TranslatedProps {
  i18nKey: string;
  children?: ReactNode;
  namespace?: string;
  data?: any;
  tags?: Record<string, (chunks: ReactNode) => ReactNode>;
  asRichText?: boolean;
  useCommonTags?: boolean;
}

export function Translated({
  i18nKey,
  children,
  namespace,
  data,
  tags,
  asRichText = false,
  useCommonTags = false,
  ...props
}: TranslatedProps & React.HTMLAttributes<HTMLSpanElement>) {
  const t = useTranslations(namespace);
  const helperKey = `${namespace ? `${namespace}.` : ""}${i18nKey}`;

  // Auto-detect rich text if tags contain HTML-like syntax
  const shouldUseRichText =
    asRichText || useCommonTags || (tags && Object.keys(tags).length > 0);

  // Use RichText component with common tags
  if (useCommonTags) {
    return (
      <RichText className={props.className}>
        {(commonTags) => (
          <span data-i18n-key={helperKey} {...props}>
            {t.rich(i18nKey, { ...data, ...commonTags, ...tags })}
          </span>
        )}
      </RichText>
    );
  }

  // If rich text is requested and tags are provided, use t.rich
  if (shouldUseRichText && tags) {
    return (
      <span data-i18n-key={helperKey} {...props}>
        {t.rich(i18nKey, { ...data, ...tags })}
      </span>
    );
  }

  // Default behavior for regular translations
  return (
    <span data-i18n-key={helperKey} {...props}>
      {t(i18nKey, data)}
    </span>
  );
}
