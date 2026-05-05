import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1a1d24",
        paper: "#fafaf7",
        accent: "#c2410c",
      },
    },
  },
  plugins: [],
};

export default config;
