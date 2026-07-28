import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'

export const dynamic = 'force-dynamic'

// 주문 포털 — 주문 현황 목록 (1단계: 조회 전용)
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const q = sp.get('q')?.trim()
  const mine = sp.get('mine') === '1'

  let query = admin
    .from('erp_orders')
    .select('id, order_no, order_date, bank_name, branch_name, staff_name, total_amount, outstanding_amount, source')
    .order('order_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)
  if (q) query = query.or(`order_no.ilike.%${q}%,bank_name.ilike.%${q}%,branch_name.ilike.%${q}%`)
  if (mine && me.employeeName) query = query.eq('staff_name', me.employeeName)

  const { data, error } = await query
  if (error) {
    // 103 미적용 폴백 — source 컬럼 없이 재시도
    const retry = await admin
      .from('erp_orders')
      .select('id, order_no, order_date, bank_name, branch_name, staff_name, total_amount, outstanding_amount')
      .order('order_date', { ascending: false })
      .limit(200)
    if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 })
    return NextResponse.json({
      rows: (retry.data ?? []).map(o => ({
        id: o.id, order_no: o.order_no, order_date: o.order_date,
        customer: [o.bank_name, o.branch_name].filter(Boolean).join(' ') || '(주문처 미상)',
        staff_name: o.staff_name,
        total_amount: o.total_amount ?? 0,
        outstanding_amount: o.outstanding_amount ?? 0,
        source: 'upload',
      })),
    })
  }
  return NextResponse.json({
    rows: (data ?? []).map(o => ({
      id: o.id, order_no: o.order_no, order_date: o.order_date,
      customer: [o.bank_name, o.branch_name].filter(Boolean).join(' ') || '(주문처 미상)',
      staff_name: o.staff_name,
      total_amount: o.total_amount ?? 0,
      outstanding_amount: o.outstanding_amount ?? 0,
      source: o.source ?? 'upload',
    })),
  })
}
