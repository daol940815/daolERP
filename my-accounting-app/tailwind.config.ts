import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // 기본 색(회청색) = 테마 변수 (직원별 화면 설정, 2026-11-05) — globals.css 의 [data-theme] 가 값을 바꾼다.
        // 의미 색(red · amber · green · blue …)은 변수로 만들지 않는다 — 테마와 무관하게 고정.
        slate: Object.fromEntries(
          ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"].map(k => [k, `rgb(var(--slate-${k}) / <alpha-value>)`]),
        ),
      },
    },
  },
  plugins: [],
};
export default config;
