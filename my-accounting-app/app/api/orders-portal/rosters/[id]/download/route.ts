import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { ROSTER_BUCKET, buildRosterExcel, type RosterRowInput } from '@/lib/delivery-roster'

export const dynamic = 'force-dynamic'

// 명단 다운로드 — ?kind=excel(현재 행, 표준 양식) | original(업로드 원본)
// 수령인 개인정보라 누가 언제 받았는지 기록한다 (erp_delivery_roster_downloads).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const kind = new URL(req.url).searchParams.get('kind') === 'original' ? 'original' : 'excel'

  const { data: roster } = await admin.from('erp_delivery_rosters').select('*').eq('id', params.id).maybeSingle()
  if (!roster) return NextResponse.json({ error: '명단을 찾을 수 없습니다.' }, { status: 404 })

  await admin.from('erp_delivery_roster_downloads').insert({ roster_id: params.id, employee_id: me.employeeId, kind })

  if (kind === 'original') {
    if (!roster.storage_path) return NextResponse.json({ error: '원본 파일이 없는 명단입니다(직접 작성).' }, { status: 404 })
    const { data: blob, error } = await admin.storage.from(ROSTER_BUCKET).download(roster.storage_path as string)
    if (error || !blob) return NextResponse.json({ error: `다운로드 실패: ${error?.message ?? '파일 없음'}` }, { status: 500 })
    const buf = Buffer.from(await blob.arrayBuffer())
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(String(roster.file_name ?? 'roster.xlsx'))}`,
      },
    })
  }

  const { data: rows } = await admin.from('erp_delivery_roster_rows').select('*').eq('roster_id', params.id).order('seq').limit(5000)
  const buf = await buildRosterExcel((rows ?? []) as unknown as RosterRowInput[])
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('배송명단.xlsx')}`,
    },
  })
}
