const tailwindMdBase = require("@geoffcodesthings/tailwind-md-base");
const defaultTheme = require("tailwindcss/resolveConfig")(
  require("tailwindcss/defaultConfig")
).theme;
const { COLORS } = require("./src/utils/colors");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,css,md,mdx,html,json,scss}",
  ],
  darkMode: "class", // or 'media'
  theme: {
    colors: COLORS,
    extend: {
      animation: {
        marquee: "marquee 25s linear infinite",
        marquee2: "marquee2 25s linear infinite",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-100%)" },
        },
        marquee2: {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0%)" },
        },
      },
      fontFamily: {
        primary: "DM Sans",
        title: "Unique",
      },
      fontSize: {
        md: "1rem",
      },
      width: {
        128: "32rem",
        256: "64rem",
      },
      markdownBase: {
        wrapperClass: "md-content",

        h1: {
          fontSize: "2rem",
        },

        h2: {
          fontSize: "1.8rem",
        },

        h3: {
          fontSize: "1.5rem",
        },

        h4: {
          fontSize: "1.2rem",
        },

        h5: {
          fontSize: "1rem",
        },

        h6: {
          fontSize: "0.8rem",
        },

        ul: {
          listStylePosition: "inside",
        },

        ol: {
          listStylePosition: "inside",
        },

        strong: {
          fontWeight: "bold",
        },

        em: {
          textDecoration: "underline",
        },

        "p > code": {
          backgroundColor: COLORS.gray[190],
          borderRadius: "0.2rem",
          fontWeight: 600,
          color: COLORS.black,
        },
        "pre > code": {
          backgroundColor: "transparent",
          padding: 0,
          fontWeight: 500,
          color: COLORS.black,
        },
        pre: {
          backgroundColor: COLORS.gray[190],
          borderRadius: "0.2rem",
          padding: "1px .5rem",
        },
      },
    },
  },
  plugins: [tailwindMdBase()],
};
