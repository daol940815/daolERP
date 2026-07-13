import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { addInvoicePayment } from '@/lib/tax-invoice-payments.server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// POST /api/purchase-cycle/apply-payments
// body: { links: [{ invoiceId, transactionId, amount }] }
// 사용자가 확인한 지급 연결 후보를 실제로 연결한다.
// addInvoicePayment가 초과 방지·상태 재계산·매칭 학습(별칭·태깅)까지 처리한다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as {
    links?: { invoiceId?: string; transactionId?: string; amount?: number }[]
  }
  const links = (body.links ?? []).filter(l => l.invoiceId && l.transactionId && (l.amount ?? 0) > 0)
  if (!links.length) return NextResponse.json({ error: '연결할 항목이 없습니다.' }, { status: 400 })

  let linked = 0
  const failures: { invoiceId: string; error: string }[] = []
  for (const l of links) {
    const r = await addInvoicePayment(admin, l.invoiceId!, l.transactionId!, l.amount!)
    if (r.ok) linked++
    else failures.push({ invoiceId: l.invoiceId!, error: r.error })
  }
  return NextResponse.json({ linked, failed: failures.length, failures: failures.slice(0, 5) })
}
