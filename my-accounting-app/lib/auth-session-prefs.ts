// 로그인 유지 정책 — 브라우저·미들웨어·서버 클라이언트가 같은 규칙으로 세션 쿠키 수명을 정한다.
//
// "로그인 상태 유지" 체크 → daol-keep-signed-in 쿠키(장기)를 두고, 세션 쿠키는 라이브러리
// 기본 수명(400일)대로 저장해 브라우저를 닫아도 자동로그인된다.
// 체크 안 함(기본) → 세션 쿠키에서 수명(maxAge·expires)을 떼어 브라우저 세션 쿠키로 만든다.
// 브라우저를 닫으면 사라져 다음 접속에는 로그인 화면이 뜬다.
// 비밀번호는 어디에도 저장하지 않는다 — 브라우저 비밀번호 저장 기능에 맡긴다.

export const KEEP_SIGNED_IN_COOKIE = 'daol-keep-signed-in'
export const LOGIN_ID_STORAGE_KEY = 'daol-login-id'
export const KEEP_SIGNED_IN_MAX_AGE = 400 * 24 * 60 * 60

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
