// Next.js 미들웨어: 인증 상태에 따라 페이지 접근을 제어
// Supabase SSR 방식으로 쿠키 기반 세션을 갱신하고 리다이렉트 처리.
// 1차 재조정(2026-09-29)부터 /api/* 는 직원별 그룹 권한도 검사한다 (docs/ui-reorg-track.md).

import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionOnly } from '@/lib/auth-session-prefs'
import { can, type PermSubject, type Permissions } from '@/lib/permissions'
import { apiOwnerOf } from '@/lib/menu-registry'

// API 호출자의 권한을 서비스 키로 1회 조회 (직원 미연결 계정은 레거시 admin으로 간주)
async function loadSubject(userId: string): Promise<(PermSubject & { employmentType: 'regular' | 'parttime' }) | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  try {
    const res = await fetch(
      `${url}/rest/v1/employees?auth_user_id=eq.${userId}&select=role,is_active,is_master,permissions,can_approve,work_end,employment_type&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' },
    )
    if (!res.ok) return null   // 109 미적용 등 — 검사 생략(레거시 동작)
    const rows = await res.json() as Array<Record<string, unknown>>
    if (!rows.length) return { role: 'admin', isMaster: false, permissions: {}, canApprove: false, employmentType: 'regular' }
    const e = rows[0]
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    const expired = e.is_active === false || (typeof e.work_end === 'string' && e.work_end < today)
    const role = (e.role === 'admin' || e.role === 'manager') ? e.role : 'sales'
    return {
      role: role as PermSubject['role'],
      isMaster: e.is_master === true && !expired,
      permissions: (e.permissions as Permissions | null) ?? {},
      canApprove: e.can_approve === true,
      expired,
      employmentType: e.employment_type === 'parttime' ? 'parttime' : 'regular',
    }
  } catch {
    return null
  }
}

export async function middleware(request: NextRequest) {
  // 환경변수 미설정 시 (개발 초기) 미들웨어 건너뜀
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next()
  }

  // 레이아웃(AreaShell)이 현재 경로를 알 수 있도록 요청 헤더에 실어 보낸다
  const pathname = request.nextUrl.pathname
  const search = request.nextUrl.search
  request.headers.set('x-pathname', pathname + search)

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
            // 토큰 갱신으로 다시 쓰는 세션 쿠키도 브라우저 세션 쿠키로 (자동로그인 없음)
            response.cookies.set(name, value, sessionOnly(options))
          )
        },
      },
    }
  )

  // 세션 정보 가져오기 (토큰 자동 갱신 포함)
  const {
    data: { user },
  } = await supabase.auth.getUser()

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

  // 이미 로그인된 사용자가 /login에 접근 시 → 업무 선택으로 이동
  if (user && pathname === '/login') {
    return redirectTo('/portal')
  }

  // ── API 권한 검사 — 화면에서 버튼을 숨기는 것만으로는 보호가 아니다 ──
  // 경로 → 그룹은 메뉴 목록(apiOwnerOf)에서, 수준은 GET/HEAD=조회 · 그 외=수정.
  // 매핑 없는 API는 로그인만으로 허용. 아르바이트는 신규 거래처(마스터) 등록 차단.
  if (user && pathname.startsWith('/api') && pathname !== '/api/area/select') {
    const owner = apiOwnerOf(pathname)
    const method = request.method.toUpperCase()
    const subject = await loadSubject(user.id)
    if (subject) {
      if (subject.expired) {
        return NextResponse.json({ error: '근무 기간이 종료된 계정입니다.' }, { status: 403 })
      }
      const isWrite = !(method === 'GET' || method === 'HEAD')
      if (owner && owner !== 'my') {
        const ok = owner === 'team'
          ? (subject.isMaster || subject.canApprove)
          : can(subject, owner, isWrite ? 'edit' : 'view')
        if (!ok) {
          return NextResponse.json({ error: isWrite ? '수정 권한이 없습니다.' : '조회 권한이 없습니다.' }, { status: 403 })
        }
      }
      if (subject.employmentType === 'parttime' && isWrite && pathname.startsWith('/api/orders-portal/masters')) {
        return NextResponse.json({ error: '아르바이트 계정은 신규 거래처·담당자를 등록할 수 없습니다. 담당 직원에게 요청하세요.' }, { status: 403 })
      }
    }
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
