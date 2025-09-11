import localFont from "next/font/local";

// Alliance No.1 Font Family
export const alliance = localFont({
  src: [
    {
      path: "./AllianceNo1-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "./AllianceNo1-Medium.ttf",
      weight: "500",
      style: "medium",
    },
    {
      path: "./AllianceNo1-SemiBold.ttf",
      weight: "600",
      style: "semibold",
    },
  ],
  variable: "--font-alliance",
  display: "swap",
});

// Canela Text Font
export const canelaText = localFont({
  src: [
    {
      path: "./CanelaTextLCWeb-Regular.ttf",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-canela-text",
  display: "swap",
});

// Frontliner Font
export const frontliner = localFont({
  src: [
    {
      path: "./Frontliner-Light.ttf",
      weight: "300",
      style: "light",
    },
  ],
  variable: "--font-frontliner",
  display: "swap",
});
