// Next.js 미들웨어: 인증 상태에 따라 페이지 접근을 제어
// Supabase SSR 방식으로 쿠키 기반 세션을 갱신하고 리다이렉트 처리

import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { KEEP_SIGNED_IN_COOKIE, sessionOnly } from '@/lib/auth-session-prefs'

export async function middleware(request: NextRequest) {
  // 환경변수 미설정 시 (개발 초기) 미들웨어 건너뜀
  // .env.local에 Supabase 키를 입력하면 정상 동작함
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next()
  }

  // 응답 객체를 먼저 생성 (쿠키 설정을 위해 필요)
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // 로그인 유지 미선택이면 토큰 갱신 때 다시 쓰는 세션 쿠키도 수명 없는 브라우저 세션 쿠키로
  const keepSignedIn = request.cookies.has(KEEP_SIGNED_IN_COOKIE)

  // Supabase 서버 클라이언트 생성 (미들웨어 전용)
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // 요청과 응답 양쪽에 쿠키를 설정해야 세션이 올바르게 갱신됨
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, keepSignedIn ? options : sessionOnly(options))
          )
        },
      },
    }
  )

  // 세션 정보 가져오기 (토큰 자동 갱신 포함)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // 리다이렉트 응답에도 갱신된 세션 쿠키를 실어 보낸다. 만료된 토큰으로 접속하면
  // getUser()가 토큰을 갱신해 response에 쿠키를 넣는데, 새 응답으로 리다이렉트하면
  // 그 쿠키가 버려져 다음 요청·페이지 렌더가 같은 만료 토큰으로 갱신을 반복한다.
  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, request.url))
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie))
    return redirect
  }

  // API는 리다이렉트 대신 401 — 외부 공개 시 로그인 없이 API를 직접 호출하는 것을 차단
  // (페이지만 검사하면 API 주소를 아는 사람은 데이터에 접근할 수 있다)
  if (!user && pathname.startsWith('/api')) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // 로그인하지 않은 사용자가 /login 이외의 페이지에 접근 시 → /login 으로 이동
  if (!user && pathname !== '/login') {
    return redirectTo('/login')
  }

  // 이미 로그인된 사용자가 /login에 접근 시 → 모드 선택으로 이동
  if (user && pathname === '/login') {
    return redirectTo('/portal')
  }

  return response
}

// 미들웨어를 적용할 경로 설정
// 정적 리소스만 제외 — /api도 검사 대상 (미로그인 API 호출은 401)
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
}
