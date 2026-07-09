import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { computeCycle, attachReviews, invTotal, type Cell, type ReviewRow, type ReviewedException } from '@/lib/purchase-cycle-status'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/purchase-cycle/vendor?vendorId=&from=YYYY-MM&to=YYYY-MM
// 거래처 진행상태 (설계 §3 — 파이프라인):
//   ERP 주문 → 세금계산서 → 지급 흐름의 누계 + 월별 셀·상태 + 확인 이력.
// 판정은 예외 목록과 같은 엔진(lib/purchase-cycle-status)을 쓰되,
// 지급 대기 롤업 등 거래처 단위 판정이 기간에 의존하므로 전체 RPC 후 필터한다.
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const vendorId = sp.get('vendorId')
  if (!vendorId) return NextResponse.json({ error: 'vendorId가 필요합니다.' }, { status: 400 })

  const now = new Date()
  const from = sp.get('from') ?? `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const to = sp.get('to') ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const lastDay = (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    const d = new Date(y, m, 0)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const { data: vendor, error: vErr } = await admin
    .from('vendors').select('id, name, type').eq('id', vendorId).single()
  if (vErr || !vendor) return NextResponse.json({ error: '거래처를 찾을 수 없습니다.' }, { status: 404 })

  // RPC 결과도 PostgREST max-rows(1000)에 잘린다 — 반드시 페이지네이션
  const cellsResult = await fetchAllRows<Cell>((rFrom, rTo) =>
    admin.rpc('purchase_cycle_summary', { p_from: `${from}-01`, p_to: lastDay(to) }).range(rFrom, rTo),
  )
  if ('error' in cellsResult) {
    return NextResponse.json(
      { error: `매입 사이클 집계 실패: ${cellsResult.error} — 060 마이그레이션 적용이 필요합니다.` },
      { status: 500 },
    )
  }

  const myCells = cellsResult.data.filter(c => c.vendor_id === vendorId)
  myCells.sort((a, b) => a.month.localeCompare(b.month))

  const vname = new Map([[vendorId, vendor.name as string]])
  const { exceptions } = computeCycle(myCells, vname, now)

  // 확인 이력 (061 미적용이면 조용히 비활성화)
  const reviewsResult = await fetchAllRows<ReviewRow>((rFrom, rTo) =>
    admin
      .from('purchase_cycle_reviews')
      .select('vendor_id, month, status, reviewed_at, reviewed_by, note, snapshot_erp, snapshot_invoice, snapshot_paid')
      .eq('vendor_id', vendorId)
      .range(rFrom, rTo),
  )
  const reviews = 'error' in reviewsResult ? [] : reviewsResult.data
  const reviewed = attachReviews(exceptions, reviews)

  // 월별 상태(월 셀 단위 판정)와 거래처 단위 판정(지급 대기·과다 지급)을 분리해 내려준다
  const monthlyStatuses = new Map<string, ReviewedException>()
  const vendorLevel: ReviewedException[] = []
  for (const e of reviewed) {
    if (e.status === '지급 대기' || e.status === '과다 지급') vendorLevel.push(e)
    else monthlyStatuses.set(e.month, e)
  }

  const months = myCells.map(c => ({
    ...c,
    judgement: monthlyStatuses.get(c.month) ?? null,  // null = 지급만 있는 달 등
  }))

  const totals = {
    erp: myCells.reduce((s, c) => s + c.erp_amount, 0),
    erp_items: myCells.reduce((s, c) => s + c.erp_items, 0),
    invoice: myCells.reduce((s, c) => s + c.invoice_supply, 0),
    // 지급 비교 기준 = 부가세 포함 총액 (062)
    invoice_total: myCells.reduce((s, c) => s + invTotal(c), 0),
    invoice_count: myCells.reduce((s, c) => s + c.invoice_count, 0),
    paid: myCells.reduce((s, c) => s + c.paid_amount, 0),
  }

  return NextResponse.json({
    vendor, from, to, totals, months, vendorLevel,
    reviews_available: !('error' in reviewsResult),
  })
}
