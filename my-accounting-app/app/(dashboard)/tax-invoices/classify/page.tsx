import { redirect } from 'next/navigation'

// 매입 계산서 일괄 분류는 계산서 내역 화면의 '매입 분류' 탭으로 통합 (2026-09-30) — 옛 주소는 탭으로 보낸다
export default function LegacyTaxInvoiceClassifyPage() {
  redirect('/tax-invoices?tab=classify')
}
