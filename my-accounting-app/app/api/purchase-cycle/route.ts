import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/purchase-cycle?from=YYYY-MM&to=YYYY-MM
// 매입 사이클 상태 엔진 (설계: docs/purchase-cycle-design.md v3)
//  - 사실 데이터(ERP·계산서·지급)는 060 RPC가 거래처×월로 집계
//  - 상태는 저장하지 않고 여기서 조회 시 계산 (§2-1)
//  - 시차를 감안한 3단계 심각도(정상대기/주의/확인필요) + 금액차이 원인 추정 (§2-2·2-3)

type Cell = {
  vendor_id: string
  month: string
  erp_amount: number
  erp_items: number
  invoice_supply: number
  invoice_count: number
  last_invoice_date: string | null
  paid_amount: number
}

export type CycleStatus = '완료' | '계산서 대기' | '지급 대기' | '금액 차이' | '과다 지급' | '경비성'
export type Severity = '정상 대기' | '주의' | '확인 필요'

interface ExceptionRow {
  vendor_id: string
  vendor_name: string
  month: string            // 'YYYY-MM' 또는 거래처 단위면 '누계'
  status: CycleStatus
  severity: Severity
  erp_amount: number
  invoice_supply: number
  paid_amount: number
  gap: number              // 상태별 핵심 차이 금액 (미지급액·차이액 등)
  detail: string           // "무엇을·얼마나·왜" 한 줄
  cause: string | null     // 금액차이 추정 원인 (내부 계산)
}

const TOL = 0.10      // 금액차이 허용범위 (실데이터로 조정 예정)
const SMALL = 0.01    // 단순 오차로 보는 범위
const PAY_TOL = 0.95  // 지급 완료로 보는 커버리지
const OVER = 1.05     // 과다 지급 경계

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`

function monthsBetween(ym: string, now: Date): number {
  const [y, m] = ym.split('-').map(Number)
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m)
}

function severityByElapsed(elapsed: number): Severity {
  if (elapsed <= 1) return '정상 대기'
  if (elapsed === 2) return '주의'
  return '확인 필요'
}

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

  const { data: cells, error } = await admin
    .rpc('purchase_cycle_summary', { p_from: `${from}-01`, p_to: lastDay(to) })
  if (error) {
    return NextResponse.json(
      { error: `매입 사이클 집계 실패: ${error.message} — 060 마이그레이션(purchase_cycle_summary) 적용이 필요합니다.` },
      { status: 500 },
    )
  }

  const { data: vendors } = await admin.from('vendors').select('id, name')
  const vname = new Map((vendors ?? []).map(v => [v.id as string, v.name as string]))

  // 거래처별로 월 셀을 모아 시차·누적(FIFO) 판정에 사용
  const byVendor = new Map<string, Cell[]>()
  for (const c of (cells ?? []) as Cell[]) {
    const arr = byVendor.get(c.vendor_id) ?? []
    arr.push(c)
    byVendor.set(c.vendor_id, arr)
  }

  const exceptions: ExceptionRow[] = []
  const summary = { 완료: 0, '계산서 대기': 0, '지급 대기': 0, '금액 차이': 0, '과다 지급': 0, 경비성: 0 }

  for (const [vendorId, arr] of Array.from(byVendor.entries())) {
    arr.sort((a, b) => a.month.localeCompare(b.month))
    const name = vname.get(vendorId) ?? '(알 수 없음)'
    const invByMonth = new Map(arr.map(c => [c.month, c.invoice_supply]))
    const totalInvoice = arr.reduce((s, c) => s + c.invoice_supply, 0)
    const totalPaid = arr.reduce((s, c) => s + c.paid_amount, 0)

    // ── 월 셀별 판정: 계산서 대기 / 금액 차이 ──
    for (const c of arr) {
      const elapsed = monthsBetween(c.month, now)

      if (c.erp_amount > 0 && c.invoice_supply === 0) {
        summary['계산서 대기']++
        const sev = severityByElapsed(elapsed)
        exceptions.push({
          vendor_id: vendorId, vendor_name: name, month: c.month,
          status: '계산서 대기', severity: sev,
          erp_amount: c.erp_amount, invoice_supply: 0, paid_amount: c.paid_amount,
          gap: c.erp_amount,
          detail: `ERP 매입 ${won(c.erp_amount)} (품목 ${c.erp_items}건) · 계산서 없음 · ${elapsed}개월 경과`,
          cause: elapsed <= 1 ? '발행 주기 내 (정상 시차 가능)' : null,
        })
        continue
      }

      if (c.erp_amount > 0 && c.invoice_supply > 0) {
        const base = Math.max(c.erp_amount, c.invoice_supply)
        const diff = Math.abs(c.erp_amount - c.invoice_supply)
        if (diff > base * TOL) {
          // 원인 추정: 전월/익월 계산서 합산 시 근사하면 시차
          const [y, m] = c.month.split('-').map(Number)
          const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`
          const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`
          const withAdj = c.invoice_supply + (invByMonth.get(prev) ?? 0) + (invByMonth.get(next) ?? 0)
          let cause: string
          let sev: Severity
          if (Math.abs(c.erp_amount - withAdj) <= Math.max(c.erp_amount, withAdj) * TOL) {
            cause = '전월/익월 발행 추정 (시차)'
            sev = '정상 대기'
          } else if (c.invoice_supply < c.erp_amount) {
            cause = '부분 발행 또는 미발행 추정'
            sev = severityByElapsed(elapsed)
          } else {
            cause = 'ERP 미입력 또는 경비성 혼재 추정'
            sev = '확인 필요'
          }
          summary['금액 차이']++
          exceptions.push({
            vendor_id: vendorId, vendor_name: name, month: c.month,
            status: '금액 차이', severity: sev,
            erp_amount: c.erp_amount, invoice_supply: c.invoice_supply, paid_amount: c.paid_amount,
            gap: c.erp_amount - c.invoice_supply,
            detail: `ERP ${won(c.erp_amount)} · 계산서 ${won(c.invoice_supply)} · 차이 ${won(diff)}`,
            cause,
          })
          continue
        }
      }

      if (c.erp_amount === 0 && c.invoice_supply > 0) {
        summary['경비성']++
        exceptions.push({
          vendor_id: vendorId, vendor_name: name, month: c.month,
          status: '경비성', severity: '정상 대기',
          erp_amount: 0, invoice_supply: c.invoice_supply, paid_amount: c.paid_amount,
          gap: 0,
          detail: `계산서 ${won(c.invoice_supply)} (${c.invoice_count}건) · ERP 무관 경비성 매입`,
          cause: null,
        })
      } else if (c.erp_amount > 0) {
        summary['완료']++
        exceptions.push({
          vendor_id: vendorId, vendor_name: name, month: c.month,
          status: '완료', severity: '정상 대기',
          erp_amount: c.erp_amount, invoice_supply: c.invoice_supply, paid_amount: c.paid_amount,
          gap: 0,
          detail: `ERP ${won(c.erp_amount)} · 계산서 ${won(c.invoice_supply)} — 근사 일치`,
          cause: null,
        })
      }
    }

    // ── 지급 대기: 거래처 단위 1행으로 롤업 (월별로 나열하면 결제매칭이 진행되기 전까지
    //    같은 거래처가 수십 행 반복되는 노이즈가 됨 — 검증에서 확인).
    //    미지급 = 계산서 누계 - 지급 누계, 심각도는 "가장 오래된 미지급 월" 기준.
    if (totalInvoice > 0 && totalPaid < totalInvoice * PAY_TOL) {
      const unpaid = totalInvoice - totalPaid
      // FIFO: 지급 누계가 커버하지 못한 첫 계산서 월
      let cum = 0
      let oldestUnpaid = arr[arr.length - 1].month
      for (const c of arr) {
        cum += c.invoice_supply
        if (c.invoice_supply > 0 && cum > totalPaid) { oldestUnpaid = c.month; break }
      }
      const lastInvoice = arr.reduce<string | null>((s, c) => (c.last_invoice_date && (!s || c.last_invoice_date > s)) ? c.last_invoice_date : s, null)
      const e = monthsBetween(oldestUnpaid, now)
      summary['지급 대기']++
      exceptions.push({
        vendor_id: vendorId, vendor_name: name, month: oldestUnpaid,
        status: '지급 대기', severity: severityByElapsed(e),
        erp_amount: 0, invoice_supply: totalInvoice, paid_amount: totalPaid,
        gap: unpaid,
        detail: `계산서 누계 ${won(totalInvoice)} · 지급 ${won(totalPaid)} · 미지급 ${won(unpaid)}` +
          (lastInvoice ? ` · 마지막 계산서 ${lastInvoice}` : '') + ` · 최초 미지급 ${oldestUnpaid} (${e}개월 경과)`,
        cause: e <= 1 ? '결제 주기 내 (정상 시차 가능)' : (totalPaid === 0 ? '결제매칭 미진행 가능성 (통장 연결 확인)' : null),
      })
    }

    // ── 거래처 단위: 과다 지급 (지급 > 계산서) ──
    if (totalInvoice > 0 && totalPaid > totalInvoice * OVER) {
      summary['과다 지급']++
      exceptions.push({
        vendor_id: vendorId, vendor_name: name, month: '누계',
        status: '과다 지급', severity: '확인 필요',
        erp_amount: 0, invoice_supply: totalInvoice, paid_amount: totalPaid,
        gap: totalPaid - totalInvoice,
        detail: `계산서 누계 ${won(totalInvoice)} · 지급 누계 ${won(totalPaid)} · 초과 ${won(totalPaid - totalInvoice)}`,
        cause: '이중지급·선급금 또는 결제매칭 누락 추정',
      })
    }
  }

  // 심각도 → 금액 순 정렬 (확인 필요 먼저, 큰 금액 먼저)
  const sevOrder: Record<Severity, number> = { '확인 필요': 0, '주의': 1, '정상 대기': 2 }
  exceptions.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || Math.abs(b.gap) - Math.abs(a.gap))

  return NextResponse.json({ from, to, exceptions, summary })
}
