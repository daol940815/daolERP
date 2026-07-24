import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/crm/worklist
// 관리 워크리스트 3종:
//  1) followups   — 다음 할 일 도래 (next_action_date 오늘+7일 이내 또는 지남)
//  2) churn_risk  — 이탈 위험: 전년 거래 & 올해 미거래, 매출 큰 순
//  3) no_intimacy — 친밀도 미입력 우선순위: 매출 A·B & 올해 거래 (확정 #4)
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
      .select('id, bank_name, branch_name, name, title, phone, counselor_now, intimacy_grade, status')
      .neq('status', 'merged')
      .range(from, to))
  if ('error' in contacts) return NextResponse.json({ error: contacts.error }, { status: 500 })
  const cmap = new Map((contacts.data as { id: string }[]).map(c => [c.id, c]))

  type S = {
    contact_id: string; total_revenue: number; revenue_grade: string
    intimacy_grade: string | null; traded_y1: boolean; traded_y0: boolean
    last_order_date: string | null; last_activity: string | null
  }
  const rows = (stats.data as S[]).filter(s => cmap.has(s.contact_id))
  const withContact = (s: S) => ({ ...cmap.get(s.contact_id)!, ...s })

  const churnRisk = rows
    .filter(s => s.traded_y1 && !s.traded_y0)
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, 100)
    .map(withContact)

  const noIntimacy = rows
    .filter(s => !s.intimacy_grade && s.traded_y0 && (s.revenue_grade === 'A' || s.revenue_grade === 'B'))
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, 100)
    .map(withContact)

  // 다음 할 일: 도래(오늘+7일)·경과 건
  const limitDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const { data: followups, error: fe } = await admin
    .from('crm_activities')
    .select('id, contact_id, activity_date, activity_type, staff_name, summary, next_action_date, next_action_memo')
    .not('next_action_date', 'is', null)
    .lte('next_action_date', limitDate)
    .order('next_action_date')
    .limit(100)
  if (fe) return NextResponse.json({ error: fe.message }, { status: 500 })
  const followupRows = (followups ?? [])
    .filter(f => cmap.has(f.contact_id as string))
    .map(f => ({ ...f, contact: cmap.get(f.contact_id as string) }))

  return NextResponse.json({
    ref_year: refYear,
    followups: followupRows,
    churn_risk: churnRisk,
    no_intimacy: noIntimacy,
  })
}
