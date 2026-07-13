// 매입 사이클 상태 엔진 — 공유 계산 로직 (설계: docs/purchase-cycle-design.md v3)
// 사실 데이터(060 RPC의 거래처×월 셀)만 받아 상태를 조회 시점에 계산한다.
// 예외 목록 API와 거래처 진행상태 API가 같은 판정을 쓰도록 여기로 분리.

export type Cell = {
  vendor_id: string
  month: string
  erp_amount: number
  erp_items: number
  invoice_supply: number
  // 부가세 포함 총액 (062) — 지급 비교 기준. 062 미적용이면 없을 수 있어 공급가로 대체.
  invoice_total?: number
  invoice_count: number
  last_invoice_date: string | null
  paid_amount: number
}

// 지급은 부가세 포함 총액으로 이뤄지므로 계산서↔지급 비교는 총액 기준 (062 검증에서 확인)
export const invTotal = (c: Cell) => c.invoice_total ?? c.invoice_supply

export type CycleStatus = '완료' | '계산서 대기' | '지급 대기' | '금액 차이' | '과다 지급' | '경비성'
export type Severity = '정상 대기' | '주의' | '확인 필요'

export interface ExceptionRow {
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

export interface CycleSummary {
  완료: number; '계산서 대기': number; '지급 대기': number
  '금액 차이': number; '과다 지급': number; 경비성: number
}

export const TOL = 0.10      // 금액차이 허용범위 (실데이터로 조정 예정)
export const PAY_TOL = 0.95  // 지급 완료로 보는 커버리지
export const OVER = 1.05     // 과다 지급 경계

export const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`

export function monthsBetween(ym: string, now: Date): number {
  const [y, m] = ym.split('-').map(Number)
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m)
}

export function severityByElapsed(elapsed: number): Severity {
  if (elapsed <= 1) return '정상 대기'
  if (elapsed === 2) return '주의'
  return '확인 필요'
}

export function computeCycle(
  cells: Cell[],
  vname: Map<string, string>,
  now: Date,
): { exceptions: ExceptionRow[]; summary: CycleSummary } {
  // 거래처별로 월 셀을 모아 시차·누적(FIFO) 판정에 사용
  const byVendor = new Map<string, Cell[]>()
  for (const c of cells) {
    const arr = byVendor.get(c.vendor_id) ?? []
    arr.push(c)
    byVendor.set(c.vendor_id, arr)
  }

  const exceptions: ExceptionRow[] = []
  const summary: CycleSummary = { 완료: 0, '계산서 대기': 0, '지급 대기': 0, '금액 차이': 0, '과다 지급': 0, 경비성: 0 }

  for (const [vendorId, arr] of Array.from(byVendor.entries())) {
    arr.sort((a, b) => a.month.localeCompare(b.month))
    const name = vname.get(vendorId) ?? '(알 수 없음)'
    const invByMonth = new Map(arr.map(c => [c.month, c.invoice_supply]))
    // ERP↔계산서 비교는 공급가, 계산서↔지급 비교는 부가세 포함 총액
    const totalInvoiceTotal = arr.reduce((s, c) => s + invTotal(c), 0)
    const totalPaid = arr.reduce((s, c) => s + c.paid_amount, 0)

    // ── 월 셀별 판정: 계산서 대기 / 금액 차이 / 완료 / 경비성 ──
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
    if (totalInvoiceTotal > 0 && totalPaid < totalInvoiceTotal * PAY_TOL) {
      const unpaid = totalInvoiceTotal - totalPaid
      // FIFO: 지급 누계가 커버하지 못한 첫 계산서 월
      let cum = 0
      let oldestUnpaid = arr[arr.length - 1].month
      for (const c of arr) {
        cum += invTotal(c)
        if (invTotal(c) > 0 && cum > totalPaid) { oldestUnpaid = c.month; break }
      }
      const lastInvoice = arr.reduce<string | null>((s, c) => (c.last_invoice_date && (!s || c.last_invoice_date > s)) ? c.last_invoice_date : s, null)
      const e = monthsBetween(oldestUnpaid, now)
      summary['지급 대기']++
      exceptions.push({
        vendor_id: vendorId, vendor_name: name, month: oldestUnpaid,
        status: '지급 대기', severity: severityByElapsed(e),
        erp_amount: 0, invoice_supply: totalInvoiceTotal, paid_amount: totalPaid,
        gap: unpaid,
        detail: `계산서 누계(부가세 포함) ${won(totalInvoiceTotal)} · 지급 ${won(totalPaid)} · 미지급 ${won(unpaid)}` +
          (lastInvoice ? ` · 마지막 계산서 ${lastInvoice}` : '') + ` · 최초 미지급 ${oldestUnpaid} (${e}개월 경과)`,
        cause: e <= 1 ? '결제 주기 내 (정상 시차 가능)' : (totalPaid === 0 ? '결제매칭 미진행 가능성 (통장 연결 확인)' : null),
      })
    }

    // ── 거래처 단위: 과다 지급 (지급 > 계산서 총액) ──
    if (totalInvoiceTotal > 0 && totalPaid > totalInvoiceTotal * OVER) {
      summary['과다 지급']++
      exceptions.push({
        vendor_id: vendorId, vendor_name: name, month: '누계',
        status: '과다 지급', severity: '확인 필요',
        erp_amount: 0, invoice_supply: totalInvoiceTotal, paid_amount: totalPaid,
        gap: totalPaid - totalInvoiceTotal,
        detail: `계산서 누계(부가세 포함) ${won(totalInvoiceTotal)} · 지급 누계 ${won(totalPaid)} · 초과 ${won(totalPaid - totalInvoiceTotal)}`,
        cause: '이중지급·선급금 또는 결제매칭 누락 추정',
      })
    }
  }

  // 심각도 → 금액 순 정렬 (확인 필요 먼저, 큰 금액 먼저)
  const sevOrder: Record<Severity, number> = { '확인 필요': 0, '주의': 1, '정상 대기': 2 }
  exceptions.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || Math.abs(b.gap) - Math.abs(a.gap))

  return { exceptions, summary }
}

// ── "확인" 이력 연동 (설계 §5 — 잠금 아님) ─────────────────────────────
// 확인 기록의 스냅샷과 현재 금액이 다르면 "재검토 필요"를 자동 표시한다.

export interface ReviewRow {
  vendor_id: string
  month: string
  status: string
  reviewed_at: string
  reviewed_by: string | null
  note: string | null
  snapshot_erp: number
  snapshot_invoice: number
  snapshot_paid: number
}

export interface ReviewInfo {
  reviewed_at: string
  reviewed_by: string | null
  note: string | null
  stale: boolean           // true = 확인 이후 데이터가 바뀜 → 재검토 필요
  snapshot_erp: number
  snapshot_invoice: number
  snapshot_paid: number
}

export type ReviewedException = ExceptionRow & { review: ReviewInfo | null }

export function attachReviews(exceptions: ExceptionRow[], reviews: ReviewRow[]): ReviewedException[] {
  // 같은 키의 확인이 여러 번이면 최신 것만 (이력은 테이블에 그대로 남는다)
  const latest = new Map<string, ReviewRow>()
  for (const r of reviews) {
    const key = `${r.vendor_id}|${r.month}|${r.status}`
    const cur = latest.get(key)
    if (!cur || r.reviewed_at > cur.reviewed_at) latest.set(key, r)
  }
  return exceptions.map(e => {
    const r = latest.get(`${e.vendor_id}|${e.month}|${e.status}`)
    if (!r) return { ...e, review: null }
    const stale = r.snapshot_erp !== Math.round(e.erp_amount)
      || r.snapshot_invoice !== Math.round(e.invoice_supply)
      || r.snapshot_paid !== Math.round(e.paid_amount)
    return {
      ...e,
      review: {
        reviewed_at: r.reviewed_at, reviewed_by: r.reviewed_by, note: r.note, stale,
        snapshot_erp: r.snapshot_erp, snapshot_invoice: r.snapshot_invoice, snapshot_paid: r.snapshot_paid,
      },
    }
  })
}
