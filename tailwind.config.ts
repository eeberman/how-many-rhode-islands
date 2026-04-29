import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#1B2A4A",
          deep: "#0F1A33",
          light: "#2A3D63",
        },
        ocean: {
          DEFAULT: "#0077B6",
          bright: "#00B4D8",
          deep: "#03466E",
        },
        bone: "#F5EFE6",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        body: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
