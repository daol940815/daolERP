import AgingManage, { PAYABLE_CONFIG } from '@/components/reports/aging-manage'

// 미지급금 관리 — 경과기간 분석 + 매입처별 요약 통합 (2026-09-30 UI 2차 정리, 통합 4)
export default function PayablesManagePage() {
  return <AgingManage cfg={PAYABLE_CONFIG} />
}
