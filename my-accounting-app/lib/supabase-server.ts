// 서버(Server Component, Route Handler, Server Action) 환경에서 Supabase에 접근하기 위한 클라이언트
// Next.js App Router의 cookies()를 사용해 세션을 안전하게 관리

import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// 서버 컴포넌트 / Route Handler에서 호출
// 쿠키 기반으로 현재 로그인된 사용자 세션을 자동으로 읽어옴
export async function createClient() {
  // Next.js 14 App Router에서 cookies()는 비동기 함수
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // 요청에서 쿠키 값 읽기
        getAll() {
          return cookieStore.getAll()
        },
        // 응답에 쿠키 값 설정 (Server Component에서는 동작 안 함 - Route Handler에서만 유효)
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component에서 setAll 호출 시 무시 (읽기 전용)
          }
        },
      },
    }
  )
}

// SERVICE_ROLE_KEY를 사용하는 관리자 클라이언트 (RLS 완전 우회 - 서버에서만 사용)
// @supabase/ssr 대신 @supabase/supabase-js 사용 — 쿠키 세션이 서비스 롤 키를 덮어쓰지 않도록
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
