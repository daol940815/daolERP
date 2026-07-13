'use client'

import { won } from './candidate-modal'

export interface ReviewInfo {
  reviewed_at: string; reviewed_by: string | null; note: string | null; stale: boolean
  snapshot_erp: number; snapshot_invoice: number; snapshot_paid: number
}

// 확인 상태 배지: 확인함(스냅샷과 동일) / 재검토 필요(확인 이후 금액 변동 — 설계 §5, 잠금 아님)
export function ReviewBadge({ review }: { review: ReviewInfo | null }) {
  if (!review) return null
  if (review.stale) {
    return (
      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-700"
        title={`확인(${review.reviewed_at.slice(0, 10)}) 이후 금액이 바뀌었습니다 — 당시 ERP ${won(review.snapshot_erp)} · 계산서 ${won(review.snapshot_invoice)} · 지급 ${won(review.snapshot_paid)}`}>
        재검토 필요
      </span>
    )
  }
  return (
    <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-green-100 text-green-700"
      title={review.note ?? undefined}>
      확인 {review.reviewed_at.slice(5, 10).replace('-', '/')}
    </span>
  )
}
