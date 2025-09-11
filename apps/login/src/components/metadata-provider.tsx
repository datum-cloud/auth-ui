"use client";

import { SITE_CONFIG } from "@/config/site";
import { createContext, ReactNode, useContext } from "react";

interface MetadataContextType {
  setPageTitle: (title: string) => void;
  setPageDescription: (description: string) => void;
  getFullTitle: (title: string) => string;
}

const MetadataContext = createContext<MetadataContextType | undefined>(
  undefined,
);

interface MetadataProviderProps {
  children: ReactNode;
}

export function MetadataProvider({ children }: MetadataProviderProps) {
  const setPageTitle = (title: string) => {
    document.title = `${SITE_CONFIG.siteTitle} - ${title}`;
  };

  const setPageDescription = (description: string) => {
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute("content", description);
    }
  };

  const getFullTitle = (title: string) => `${SITE_CONFIG.siteTitle} - ${title}`;

  return (
    <MetadataContext.Provider
      value={{ setPageTitle, setPageDescription, getFullTitle }}
    >
      {children}
    </MetadataContext.Provider>
  );
}

export function usePageMetadata() {
  const context = useContext(MetadataContext);
  if (context === undefined) {
    throw new Error("usePageMetadata must be used within a MetadataProvider");
  }
  return context;
}
