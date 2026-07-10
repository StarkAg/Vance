/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Shiv Hardware Attendance theme (dark mode palette) — warm parchment/brass instead of neutral black/gold.
        ink: "#12110f",
        panel: "#1a1815",
        panel2: "#211e1a",
        line: "rgba(255,255,255,0.10)",
        muted: "#a8a29e",
        brand: "#c9a45c",
        good: "#7fae63",
        bad: "#d3595c",
        warn: "#d9a441",
      },
      fontFamily: {
        sans: ["Space Grotesk", "ui-sans-serif", "system-ui", "sans-serif"],
        brand: ["AmericanCaptain", "Space Grotesk", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
