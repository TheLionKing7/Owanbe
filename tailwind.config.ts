import type { Config } from "tailwindcss";

// Brand palette: owanbe-brand-kit/tokens + values sampled from the approved homepage mockup.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: { DEFAULT: "#FFF6EE", 50: "#FFFBF7", 100: "#FFF6EE", 200: "#FDEFE4" },
        plum: {
          950: "#1E0A2B", // headline ink
          900: "#2A0F38",
          800: "#410B52", // primary buttons, Home pill
          700: "#4F0E63",
          600: "#5C1272", // wordmark, links
          500: "#6B1E8E", // "Celebrate." accent
          100: "#F3E8F7",
        },
        ink: { DEFAULT: "#1C1224", muted: "#62566E", subtle: "#9A90A3" },
        gold: { DEFAULT: "#F8AC00", 300: "#FFD27A", 100: "#FDE7B5" },
        owanbe: {
          "royal-purple": "#4B2E83",
          "sun-gold": "#F7B500",
          "yoruba-blue": "#0088A8",
          "emerald-green": "#0E7D6B",
          "vibrant-red": "#E63946",
          "fuchsia-pink": "#D81B8D",
          cream: "#FFF9F0",
          charcoal: "#1A1A1A",
        },
        cat: {
          venues: "#FCB10C",
          catering: "#073891",
          decoration: "#FB6335",
          photo: "#0587B5",
          fashion: "#E30974",
          music: "#168AA1",
        },
        verified: "#0A3BD6",
      },
      fontFamily: {
        display: ['"Playfair Display"', "Georgia", "serif"],
        sans: ['Figtree', "Montserrat", "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
      },
      boxShadow: {
        card: "0 10px 30px -12px rgba(65, 11, 82, 0.18), 0 2px 6px -2px rgba(65, 11, 82, 0.06)",
        search: "0 14px 34px -14px rgba(65, 11, 82, 0.28)",
        pill: "0 6px 16px -8px rgba(65, 11, 82, 0.55)",
      },
      borderRadius: { "4xl": "1.25rem" },
      maxWidth: { page: "1536px" },
    },
  },
  plugins: [],
} satisfies Config;
