import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const maxDuration = 60

// GET /api/transactions?status=all&from=YYYY-MM-DD&to=YYYY-MM-DD&source=all
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const status        = searchParams.get('status') ?? 'all'
  const from          = searchParams.get('from')
  const to            = searchParams.get('to')
  const source        = searchParams.get('source') ?? 'all'
  const bankAccountId = searchParams.get('bankAccountId')
  const vendorId      = searchParams.get('vendorId')

  // 전체 조회(range) — PostgREST max-rows(1000) 절단 방지
  const result = await fetchAllRows<Record<string, unknown>>((f, t) => {
    let query = admin
      .from('transactions')
      .select(
        `id, tx_date, tx_time, description, counterparty_name, amount_in, amount_out, balance,
         source, account_alias, bank_account_id, vendor_id, status, memo, is_journalized,
         suggested_account_id, confirmed_account_id, suggested_side,
         ai_confidence, ai_reason, upload_log_id, transfer_pair_id, created_at`,
      )
      .order('tx_date', { ascending: false })
      .order('tx_time', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
    if (status !== 'all')  query = query.eq('status', status)
    if (from)              query = query.gte('tx_date', from)
    if (to)                query = query.lte('tx_date', to)
    if (source !== 'all')  query = query.eq('source', source)
    if (bankAccountId)     query = query.eq('bank_account_id', bankAccountId)
    if (vendorId)          query = query.eq('vendor_id', vendorId)
    return query.range(f, t)
  })

  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  // 계산서 결제연결을 거래 쪽에도 붙인다 — 계산서에서 매칭하면 통장 화면에서도
  // 어떤 계산서와 연결됐는지 보여야 한다(양방향). 연결 테이블 전체를 한 번에
  // 읽어 메모리에서 붙인다(거래 id로 .in() 하면 수십 번의 청크 조회가 필요).
  type PayLink = {
    transaction_id: string
    amount: number
    tax_invoice: {
      id: string; direction: string; issue_date: string
      counterparty_name: string | null; total_amount: number
    } | null
  }
  const payResult = await fetchAllRows<PayLink>((f, t) =>
    admin
      .from('tax_invoice_payments')
      .select('transaction_id, amount, tax_invoice:tax_invoices(id, direction, issue_date, counterparty_name, total_amount)')
      .range(f, t) as unknown as PromiseLike<{ data: PayLink[] | null; error: { message: string } | null }>,
  )
  if (!('error' in payResult)) {
    const linksByTx = new Map<string, { amount: number; invoice: NonNullable<PayLink['tax_invoice']> }[]>()
    for (const p of payResult.data) {
      if (!p.tax_invoice) continue
      const arr = linksByTx.get(p.transaction_id) ?? []
      arr.push({ amount: p.amount, invoice: p.tax_invoice })
      linksByTx.set(p.transaction_id, arr)
    }
    for (const tx of result.data) {
      const links = linksByTx.get(tx.id as string)
      if (links) tx.invoice_links = links
    }
  }

  return NextResponse.json({ data: result.data })
}

// DELETE /api/transactions — body: { ids: string[] }
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const { ids } = await req.json() as { ids: string[] }

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: '삭제할 항목을 선택하세요.' }, { status: 400 })
  }

  // 삭제 전 영향받는 upload_log_id 목록 수집
  const { data: txRows } = await admin
    .from('transactions')
    .select('upload_log_id')
    .in('id', ids)

  const affectedLogIds = Array.from(new Set(
    (txRows ?? []).map(r => r.upload_log_id).filter(Boolean) as string[]
  ))

  // 거래 내역 삭제
  const { error } = await admin
    .from('transactions')
    .delete()
    .in('id', ids)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 관련 업로드 이력 삭제 → 동일 파일 재업로드 허용
  if (affectedLogIds.length > 0) {
    await admin.from('upload_logs').delete().in('id', affectedLogIds)
  }

  return NextResponse.json({ ok: true, deleted: ids.length })
}
