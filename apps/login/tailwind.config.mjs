import sharedConfig from "@zitadel/tailwind-config/tailwind.config.mjs";

let colors = {
  background: { light: { contrast: {} }, dark: { contrast: {} } },
  primary: { light: { contrast: {} }, dark: { contrast: {} } },
  warn: { light: { contrast: {} }, dark: { contrast: {} } },
  text: { light: { contrast: {} }, dark: { contrast: {} } },
  link: { light: { contrast: {} }, dark: { contrast: {} } },
};

const shades = [
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
];
const themes = ["light", "dark"];
const types = ["background", "primary", "warn", "text", "link"];
types.forEach((type) => {
  themes.forEach((theme) => {
    shades.forEach((shade) => {
      colors[type][theme][shade] = `var(--theme-${theme}-${type}-${shade})`;
      colors[type][theme][`contrast-${shade}`] =
        `var(--theme-${theme}-${type}-contrast-${shade})`;
      colors[type][theme][`secondary-${shade}`] =
        `var(--theme-${theme}-${type}-secondary-${shade})`;
    });
  });
});

/** @type {import('tailwindcss').Config} */
export default {
  presets: [sharedConfig],
  darkMode: "class",
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    // Include config and vars files to trigger rebuilds when they change
    "./tailwind.config.mjs",
    "./src/styles/vars.scss",
  ],
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      colors: {
        ...colors,
        // Custom color palette
        navy: "var(--color-navy)",
        cream: "var(--color-cream)",
        "light-gray": "var(--color-light-gray)",
        "lime-green": "var(--color-lime-green)",
        "dark-navy-blue": "var(--color-dark-navy-blue)",
        "light-pink": "var(--color-light-pink)",
        mauve: "var(--color-mauve)",
        "navy-muted": "var(--color-navy-muted)",
        orange: "var(--color-orange)",
        tuscany: "var(--color-tuscany)",
        indigo: "var(--color-indigo)",
        "pearl-gray": "var(--color-pearl-gray)",
        "green-dark": "var(--color-green-dark)",
        state: {
          success: {
            light: {
              background: "#cbf4c9",
              color: "#0e6245",
            },
            dark: {
              background: "#68cf8340",
              color: "#cbf4c9",
            },
          },
          error: {
            light: {
              background: "#ffc1c1",
              color: "#620e0e",
            },
            dark: {
              background: "#af455359",
              color: "#ffc1c1",
            },
          },
          neutral: {
            light: {
              background: "#e4e7e4",
              color: "#000000",
            },
            dark: {
              background: "#1a253c",
              color: "#ffffff",
            },
          },
          alert: {
            light: {
              background: "#fbbf24",
              color: "#92400e",
            },
            dark: {
              background: "#92400e50",
              color: "#fbbf24",
            },
          },
        },

        // PURPOSE TOKENs
        "body-background": "var(--body-background)",
        "body-foreground": "var(--body-foreground)",

        "card-background": "var(--card-background)",
        "card-border": "var(--card-border)",

        "input-background": "var(--input-background)",
        "input-foreground": "var(--input-foreground)",
        "input-border": "var(--input-border)",
        "input-focus": "var(--input-focus)",

        "loader-color": "var(--loader-color)",
        "loader-button-color": "var(--loader-button-color)",

        "button-foreground": "var(--button-foreground)",
        "button-primary-background": "var(--button-primary-background)",
        "button-primary-foreground": "var(--button-primary-foreground)",
        "button-ghost-background": "var(--button-ghost-background)",
        "button-ghost-foreground": "var(--button-ghost-foreground)",

        "button-idp-background": "var(--button-idp-background)",
        "button-idp-foreground": "var(--button-idp-foreground)",
        "button-idp-border": "var(--button-idp-border)",
        "button-idp-focus": "var(--button-idp-focus)",
      },
      fontFamily: {
        alliance: ["var(--font-alliance)"],
        "canela-text": ["var(--font-canela-text)"],
        frontliner: ["var(--font-frontliner)"],
      },
      animation: {
        shake: "shake .8s cubic-bezier(.36,.07,.19,.97) both;",
      },
      keyframes: {
        shake: {
          "10%, 90%": {
            transform: "translate3d(-1px, 0, 0)",
          },

          "20%, 80%": {
            transform: "translate3d(2px, 0, 0)",
          },

          "30%, 50%, 70%": {
            transform: "translate3d(-4px, 0, 0)",
          },

          "40%, 60%": {
            transform: "translate3d(4px, 0, 0)",
          },
        },
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
