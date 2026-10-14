import type { Config } from "tailwindcss";

// Приведено к оригинальному билду: в его CSS определены ТОЛЬКО --background/--foreground.
// Остальные shadcn-токены (primary/card/muted/…) в билде отсутствовали — компоненты
// полагаются на явные классы (bg-neutral-800, bg-[#5c02e4] и т.п.). Радиусы — дефолтные.
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      // Мягкая геометрия — увеличенные скругления по всему сайту (убираем «остроту»).
      borderRadius: {
        DEFAULT: "0.5rem", // 8px
        sm: "0.4rem", // ~6px
        md: "0.625rem", // 10px
        lg: "0.9rem", // ~14px
        xl: "1.15rem", // ~18px
        "2xl": "1.5rem", // 24px
        "3xl": "1.9rem", // ~30px
        full: "9999px",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(-4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        fadeIn: "fadeIn 0.2s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
