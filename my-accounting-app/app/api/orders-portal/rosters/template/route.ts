import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/user-role'
import { buildRosterTemplate } from '@/lib/delivery-roster'

export const dynamic = 'force-dynamic'

// 배송명단 표준 양식 다운로드 (헤더 고정 — 이 양식으로만 업로드 가능)
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const buf = await buildRosterTemplate()
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('배송명단 양식.xlsx')}`,
    },
  })
}
