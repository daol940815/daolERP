// 로그인 유지 정책 — 브라우저·미들웨어·서버 클라이언트가 같은 규칙으로 세션 쿠키 수명을 정한다.
//
// 세션 쿠키는 항상 브라우저 세션 쿠키(수명 없음)로 저장한다. 브라우저를 닫으면 사라져
// 다음 접속에는 로그인 화면이 뜬다 (2026-09-18 사용자 확정 — 자동로그인 없음).
// 라이브러리(@supabase/ssr)가 maxAge 400일을 강제하므로 쿠키를 쓰는 지점에서 수명을 떼어낸다.
// 아이디만 localStorage에 기억하고, 비밀번호는 어디에도 저장하지 않는다 — 브라우저 저장 기능에 맡긴다.

export const LOGIN_ID_STORAGE_KEY = 'daol-login-id'

interface CookieLifetime {
  maxAge?: number
  expires?: Date
}

// 삭제(maxAge 0)는 그대로 두고, 저장 쿠키만 수명을 제거해 세션 쿠키로 바꾼다.
export function sessionOnly<T extends CookieLifetime>(options: T): T {
  if (options.maxAge === 0) return options
  const rest = { ...options }
  delete rest.maxAge
  delete rest.expires
  return rest
}
