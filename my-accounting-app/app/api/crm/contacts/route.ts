import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/crm/contacts?ref_year=2026
// 고객 목록: crm_contacts(기본 정보) + crm_contact_stats(매출·등급) 병합.
// 필터·정렬은 화면에서 수행 (3천여 행 — customers 목록과 동일한 방식).
// 신규/이탈 카운트(기준연도·전년)도 함께 반환해 상단 타일에 사용.
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const refYearRaw = new URL(req.url).searchParams.get('ref_year')
  const refYear = refYearRaw ? parseInt(refYearRaw, 10) : new Date().getFullYear()

  const stats = await fetchAllRows((from, to) =>
    admin.rpc('crm_contact_stats', { p_ref_year: refYear }).range(from, to))
  if ('error' in stats) return NextResponse.json({ error: stats.error }, { status: 500 })

  const contacts = await fetchAllRows((from, to) =>
    admin
      .from('crm_contacts')
      .select('id, bank_name, branch_name, name, title, role, phone, counselor_now, status')
      .neq('status', 'merged')
      .range(from, to))
  if ('error' in contacts) return NextResponse.json({ error: contacts.error }, { status: 500 })

  type StatRow = {
    contact_id: string; total_revenue: number; revenue_grade: string; continuity_grade: string
    intimacy_grade: string | null; overall_grade: string
    traded_y2: boolean; traded_y1: boolean; traded_y0: boolean
    last_order_date: string | null; last_activity: string | null
  }
  const statMap = new Map((stats.data as StatRow[]).map(s => [s.contact_id, s]))

  const rows = (contacts.data as Record<string, unknown>[]).map(c => {
    const s = statMap.get(c.id as string)
    return {
      contact_id: c.id,
      bank_name: c.bank_name, branch_name: c.branch_name,
      name: c.name, title: c.title, role: c.role,
      phone: c.phone, counselor_now: c.counselor_now, status: c.status,
      total_revenue: s?.total_revenue ?? 0,
      revenue_grade: s?.revenue_grade ?? 'D',
      continuity_grade: s?.continuity_grade ?? 'D',
      intimacy_grade: s?.intimacy_grade ?? null,
      overall_grade: s?.overall_grade ?? 'D',
      traded_y2: s?.traded_y2 ?? false,
      traded_y1: s?.traded_y1 ?? false,
      traded_y0: s?.traded_y0 ?? false,
      last_order_date: s?.last_order_date ?? null,
      last_activity: s?.last_activity ?? null,
    }
  })

  // 신규/이탈 카운트 (기준연도)
  const nc = await admin.rpc('crm_new_churn', { p_year: refYear })
  if (nc.error) return NextResponse.json({ error: nc.error.message }, { status: 500 })
  const newCount = (nc.data as { kind: string }[]).filter(r => r.kind === 'new').length
  const churnCount = (nc.data as { kind: string }[]).filter(r => r.kind === 'churn').length

  const counselors = Array.from(new Set(rows.map(r => r.counselor_now).filter(Boolean))).sort()

  return NextResponse.json({
    data: rows, counselors, ref_year: refYear,
    new_count: newCount, churn_count: churnCount,
  })
}
