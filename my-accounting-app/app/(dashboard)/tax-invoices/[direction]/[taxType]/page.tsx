import { redirect } from 'next/navigation'

// 계산서 4종 화면은 계산서 내역 화면의 칩(구분 · 종류)으로 통합 (2026-09-30) — 옛 주소는 칩 상태로 보낸다 (?invoiceId= 유지)
export default function LegacyTaxInvoiceListPage({ params, searchParams }: {
  params: { direction: string; taxType: string }
  searchParams: { invoiceId?: string }
}) {
  const p = new URLSearchParams({
    dir: params.direction === 'purchase' ? 'purchase' : 'sales',
    tax: params.taxType === 'exempt' ? 'exempt' : 'taxable',
  })
  if (searchParams.invoiceId) p.set('invoiceId', searchParams.invoiceId)
  redirect(`/tax-invoices?${p}`)
}
