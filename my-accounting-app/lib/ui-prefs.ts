// 직원별 화면 설정 — 글자 크기 · 색 테마 (2026-11-05 사용자 결정, 113). 서버 · 브라우저 공용.
//
// 적용 방식(화면 파일을 고치지 않는다):
//  · 글자 크기: <html> 의 font-size 를 단계별로 바꾼다 → Tailwind 의 rem 기반 클래스가 전부 비례해 커진다.
//    그래서 화면 코드에 고정 px 글자 크기(text-[숫자px] 형식)를 쓰면 안 된다 — scripts/check-ui.mjs 가 빌드에서 막는다.
//  · 색 테마: Tailwind 의 slate 팔레트를 CSS 변수로 바꿔 두었다(tailwind.config.ts, app/globals.css). <html data-theme> 에 따라
//    사이드바 · 주요 버튼 · 선택 표시의 기본 색이 바뀐다. 의미 색(빨강=지남, 주황=오늘, 초록=완료 등)은 테마와 무관하게 고정.
// 저장: employees.ui_prefs(계정, 원본) + 쿠키 UI_PREFS_COOKIE(첫 화면 깜빡임 방지용 사본 — 루트 레이아웃이 읽는다).

export type FontScale = 'sm' | 'md' | 'lg'
export type UiTheme = 'default' | 'navy' | 'green' | 'warm'
export interface UiPrefs { fontScale: FontScale; theme: UiTheme }

export const DEFAULT_UI_PREFS: UiPrefs = { fontScale: 'md', theme: 'default' }
export const FONT_SCALES: FontScale[] = ['sm', 'md', 'lg']
export const FONT_SCALE_LABEL: Record<FontScale, string> = { sm: '작게', md: '보통', lg: '크게' }
export const FONT_SCALE_PERCENT: Record<FontScale, string> = { sm: '93.75%', md: '100%', lg: '112.5%' }   // 15 · 16 · 18px
export const UI_THEMES: UiTheme[] = ['default', 'navy', 'green', 'warm']
export const UI_THEME_LABEL: Record<UiTheme, string> = { default: '기본 (회청색)', navy: '네이비', green: '그린', warm: '따뜻한 회색' }
// 설정 화면 미리보기 색 (globals.css 의 --slate-900 / -100 과 같은 값)
export const UI_THEME_SWATCH: Record<UiTheme, { dark: string; light: string }> = {
  default: { dark: '#0f172a', light: '#f1f5f9' },
  navy: { dark: '#1a2440', light: '#e8edf6' },
  green: { dark: '#183229', light: '#e1efe9' },
  warm: { dark: '#1c1917', light: '#f5f5f4' },
}

export const UI_PREFS_COOKIE = 'daol-ui'
export const UI_PREFS_EVENT = 'daol:ui-prefs'

// 알 수 없는 값은 기본값으로 (테마를 없애거나 저장값이 깨져도 안전)
export function normalizeUiPrefs(v: unknown): UiPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    fontScale: FONT_SCALES.includes(o.fontScale as FontScale) ? o.fontScale as FontScale : DEFAULT_UI_PREFS.fontScale,
    theme: UI_THEMES.includes(o.theme as UiTheme) ? o.theme as UiTheme : DEFAULT_UI_PREFS.theme,
  }
}
export const encodeUiPrefs = (p: UiPrefs) => `${p.fontScale}.${p.theme}`
export function decodeUiPrefs(s: string | undefined | null): UiPrefs {
  const [fontScale, theme] = (s ?? '').split('.')
  return normalizeUiPrefs({ fontScale, theme })
}

// <html> 에 줄 속성 — 루트 레이아웃(서버)과 브라우저 적용이 같은 값을 쓴다
export const htmlAttrs = (p: UiPrefs) => ({ 'data-theme': p.theme, style: { fontSize: FONT_SCALE_PERCENT[p.fontScale] } })

// 브라우저: 즉시 적용 + 쿠키 사본 갱신(1년, 인증과 무관한 표시 설정)
export function applyUiPrefs(p: UiPrefs) {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.dataset.theme = p.theme
  el.style.fontSize = FONT_SCALE_PERCENT[p.fontScale]
  document.cookie = `${UI_PREFS_COOKIE}=${encodeUiPrefs(p)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
}
