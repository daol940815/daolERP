import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { computeCycle, attachReviews, type Cell, type ReviewRow } from '@/lib/purchase-cycle-status'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/purchase-cycle?from=YYYY-MM&to=YYYY-MM
// 매입 사이클 상태 엔진 (설계: docs/purchase-cycle-design.md v3)
//  - 사실 데이터(ERP·계산서·지급)는 060 RPC가 거래처×월로 집계
//  - 상태는 저장하지 않고 조회 시 계산 (§2-1) — 판정은 lib/purchase-cycle-status.ts
//  - 확인 이력(061)의 스냅샷과 현재 금액이 다르면 "재검토 필요" (§5)

export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const now = new Date()
  const defTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const from = sp.get('from') ?? `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const to = sp.get('to') ?? defTo

  const lastDay = (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    const d = new Date(y, m, 0)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  // RPC 결과도 PostgREST max-rows(1000)에 잘린다 — 셀이 1,700개를 넘으므로 반드시 페이지네이션
  const cellsResult = await fetchAllRows<Cell>((rFrom, rTo) =>
    admin.rpc('purchase_cycle_summary', { p_from: `${from}-01`, p_to: lastDay(to) }).range(rFrom, rTo),
  )
  if ('error' in cellsResult) {
    return NextResponse.json(
      { error: `매입 사이클 집계 실패: ${cellsResult.error} — 060 마이그레이션(purchase_cycle_summary) 적용이 필요합니다.` },
      { status: 500 },
    )
  }
  const cells = cellsResult.data

  const { data: vendors } = await admin.from('vendors').select('id, name')
  const vname = new Map((vendors ?? []).map(v => [v.id as string, v.name as string]))

  const { exceptions, summary } = computeCycle(cells, vname, now)

  // 확인 이력 — 테이블(061)이 아직 없으면 확인 기능만 조용히 비활성화
  const reviewsResult = await fetchAllRows<ReviewRow>((rFrom, rTo) =>
    admin
      .from('purchase_cycle_reviews')
      .select('vendor_id, month, status, reviewed_at, reviewed_by, note, snapshot_erp, snapshot_invoice, snapshot_paid')
      .range(rFrom, rTo),
  )
  const reviews = 'error' in reviewsResult ? [] : reviewsResult.data
  const reviewed = attachReviews(exceptions, reviews)

  return NextResponse.json({
    from, to, exceptions: reviewed, summary,
    reviews_available: !('error' in reviewsResult),
  })
}
