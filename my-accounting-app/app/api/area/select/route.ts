import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/user-role'
import { areaByKey, areasFor, type AreaKey } from '@/lib/permissions'
import { AREA_COOKIE } from '@/lib/area-shell'

export const dynamic = 'force-dynamic'

// GET /api/area/select?area=finance — 마지막 선택 영역을 쿠키에 남기고 그 영역 홈으로 이동.
// 권한 없는 영역을 지정하면 업무 선택으로 되돌린다.
export async function GET(request: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.redirect(new URL('/login', request.url))

  const key = request.nextUrl.searchParams.get('area') as AreaKey | null
  const allowed = areasFor(me).some(a => a.key === key)
  if (!key || !allowed) return NextResponse.redirect(new URL('/portal', request.url))

  const res = NextResponse.redirect(new URL(areaByKey(key).home, request.url))
  res.cookies.set(AREA_COOKIE, key, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
  return res
}
