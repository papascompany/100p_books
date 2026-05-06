import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * 100p_books — Nike Design System
 *
 * Colors: ink #111111 / canvas #ffffff / soft-cloud #f5f5f5
 * Type: Bebas Neue (campaign) + Inter (UI)
 * Radius: none (cards) / lg=30px pill (CTAs) / full=9999px (icon btns)
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        lg: "2rem",
      },
      screens: {
        "2xl": "1280px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        /* Nike palette direct tokens */
        ink: "#111111",
        canvas: "#ffffff",
        "soft-cloud": "#f5f5f5",
        charcoal: "#39393b",
        ash: "#4b4b4d",
        mute: "#707072",
        stone: "#9e9ea0",
        hairline: "#cacacb",
        "hairline-soft": "#e5e5e5",
        sale: "#d30005",
        success: "#007d48",
      },
      borderRadius: {
        /* Nike scale */
        none: "0px",
        sm: "18px",
        md: "24px",
        lg: "30px",            /* pill CTAs */
        full: "9999px",        /* icon buttons, swatch dots */
        /* keep shadcn aliases mapping to Nike lg */
        DEFAULT: "0px",
      },
      fontFamily: {
        /* Pretendard Variable — 한글/UI 기본 폰트 */
        sans: [
          "Pretendard Variable",
          "Pretendard",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        display: [
          "Pretendard Variable",
          "Pretendard",
          "ui-sans-serif",
          "sans-serif",
        ],
        /* Bebas Neue — 숫자/영문 디스플레이 전용 */
        campaign: [
          "Bebas Neue",
          "Anton",
          "Impact",
          "Arial Black",
          "sans-serif",
        ],
      },
      fontSize: {
        /* Nike display scale */
        "campaign-lg": ["96px", { lineHeight: "0.9", letterSpacing: "-0.005em" }],
        "campaign-md": ["64px", { lineHeight: "0.9", letterSpacing: "-0.005em" }],
        "campaign-sm": ["48px", { lineHeight: "0.9", letterSpacing: "-0.005em" }],
      },
      boxShadow: {
        /* Nike: no elevation shadows — only hairline dividers */
        soft: "none",
        "soft-lg": "none",
        "inset-hairline": "inset 0 -1px 0 #e5e5e5",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.2s ease-out both",
      },
      spacing: {
        /* Nike spacing scale */
        "section": "48px",
      },
    },
  },
  plugins: [animate],
};

export default config;
