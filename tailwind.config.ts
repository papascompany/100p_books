import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * 100p_books — Modern Casual Design System ("코랄 포인트")
 *
 * 무드: 모던 캐주얼 / 세련 + 감성
 * Colors: ink #141414 / paper #FFFFFF / canvas #FAFAFA
 *         coral #FF6B5E (포인트) / peach #FFD9D2 (보조) / amber #FFB23E (별점)
 * Type: Bebas Neue (campaign) + Pretendard (UI)
 * Radius: sm 12 / md 16 / lg 20 / xl 28 / full pill
 * Shadow: soft 계열 미세 그림자 부활 (감성 입체감)
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
        /* 포인트 팔레트 — 코랄/피치/앰버 */
        coral: {
          DEFAULT: "#FF6B5E",
          50: "#FFF3F1",
          100: "#FFE4E0",
          200: "#FFC9C1",
          300: "#FFA89C",
          400: "#FF8678",
          500: "#FF6B5E",
          600: "#ED4F40",
          700: "#C93829",
          foreground: "#FFFFFF",
        },
        peach: "#FFD9D2",
        "star-amber": "#FFB23E",
        /* 모노 직접 토큰 — CSS 변수 기반(라이트/다크 자동 반전) */
        ink: "hsl(var(--ink))",
        paper: "hsl(var(--paper))",
        canvas: "hsl(var(--canvas))",
        "soft-cloud": "hsl(var(--soft-cloud))",
        hairline: "hsl(var(--hairline))",
        mute: "hsl(var(--mute-fg))",
        stone: "hsl(var(--stone-fg))",
        /* 항상 어두운 섹션 배경 (다크 무관 고정) */
        night: "#141414",
        charcoal: "#39393b",
        ash: "#4b4b4d",
        "hairline-soft": "#efeff1",
        sale: "#d30005",
        success: "#007d48",
      },
      borderRadius: {
        /* 모던 캐주얼 — 부드러운 곡률 */
        none: "0px",
        sm: "12px",
        md: "16px",
        lg: "20px",
        xl: "28px",
        "2xl": "32px",
        full: "9999px",
        DEFAULT: "14px",
      },
      fontFamily: {
        /* Pretendard Variable — 한글/UI 기본 폰트 (next/font CSS 변수) */
        sans: [
          "var(--font-pretendard)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        display: [
          "var(--font-pretendard)",
          "ui-sans-serif",
          "sans-serif",
        ],
        /* Bebas Neue — 숫자/영문 디스플레이 전용 (next/font CSS 변수) */
        campaign: [
          "var(--font-bebas-neue)",
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
        /* 감성 입체감 — 미세한 soft shadow 계열 */
        soft: "0 1px 2px rgba(20,20,20,0.04), 0 2px 8px rgba(20,20,20,0.05)",
        "soft-lg":
          "0 2px 4px rgba(20,20,20,0.04), 0 8px 24px rgba(20,20,20,0.07)",
        "soft-xl":
          "0 4px 8px rgba(20,20,20,0.04), 0 16px 40px rgba(20,20,20,0.10)",
        "coral-glow": "0 8px 24px rgba(255,107,94,0.30)",
        "inset-hairline": "inset 0 -1px 0 #e4e4e7",
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
        "fade-up": {
          from: { opacity: "0", transform: "translateY(24px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.2s ease-out both",
        "fade-up": "fade-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) both",
        "scale-in": "scale-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
        float: "float 5s ease-in-out infinite",
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
