// 브라우저(클라이언트) 환경에서 Supabase에 접근하기 위한 클라이언트 팩토리
// 컴포넌트, 훅 등 클라이언트 컴포넌트에서 사용
// 주의: 모듈 레벨에서 인스턴스를 생성하지 않음 - 환경변수 누락 시 빌드 오류 방지

import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'
import { sessionOnly } from '@/lib/auth-session-prefs'

// NEXT_PUBLIC_ 접두어가 있어야 브라우저에서 환경변수에 접근 가능
// 호출 시점에 인스턴스를 생성하므로 정적 빌드 중 오류 없음
//
// 세션 쿠키는 브라우저 세션 쿠키로만 저장한다(닫으면 로그아웃). 라이브러리가 수명을
// 400일로 강제하므로 쿠키를 직접 써서 수명을 떼어낸다 — 로그인·토큰 자동 갱신 모두 이 경로.
export function createClient(opts?: { singleton?: boolean }) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      isSingleton: opts?.singleton ?? true,
      cookies: {
        getAll() {
          return parseCookieHeader(document.cookie).map(c => ({ name: c.name, value: c.value ?? '' }))
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            document.cookie = serializeCookieHeader(name, value, sessionOnly(options))
          })
        },
      },
    },
  )
}
