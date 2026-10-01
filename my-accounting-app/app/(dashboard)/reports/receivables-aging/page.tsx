import AgingManage, { RECEIVABLE_CONFIG } from '@/components/reports/aging-manage'

// 미수금 관리 — 경과기간 분석 + 매출처별 요약 통합 (2026-09-30 UI 2차 정리, 통합 4)
export default function ReceivablesManagePage() {
  return <AgingManage cfg={RECEIVABLE_CONFIG} />
}
