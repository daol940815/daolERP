// Next.js 미들웨어: 인증 상태에 따라 페이지 접근을 제어
// Supabase SSR 방식으로 쿠키 기반 세션을 갱신하고 리다이렉트 처리

import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

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
            response.cookies.set(name, value, options)
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

  // 로그인하지 않은 사용자가 /login 이외의 페이지에 접근 시 → /login 으로 이동
  if (!user && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 이미 로그인된 사용자가 /login에 접근 시 → / (대시보드)로 이동
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

// 미들웨어를 적용할 경로 설정
// _next/static, _next/image, favicon.ico, api 등 정적 리소스는 제외
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
}
