// 브라우저(클라이언트) 환경에서 Supabase에 접근하기 위한 클라이언트 팩토리
// 컴포넌트, 훅 등 클라이언트 컴포넌트에서 사용
// 주의: 모듈 레벨에서 인스턴스를 생성하지 않음 - 환경변수 누락 시 빌드 오류 방지

import { createBrowserClient } from '@supabase/ssr'

// NEXT_PUBLIC_ 접두어가 있어야 브라우저에서 환경변수에 접근 가능
// 호출 시점에 인스턴스를 생성하므로 정적 빌드 중 오류 없음
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
