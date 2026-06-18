import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

// GET /api/transactions?status=all&from=YYYY-MM-DD&to=YYYY-MM-DD&source=all&limit=1000
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const status        = searchParams.get('status') ?? 'all'
  const from          = searchParams.get('from')
  const to            = searchParams.get('to')
  const source        = searchParams.get('source') ?? 'all'
  const bankAccountId = searchParams.get('bankAccountId')
  const vendorId      = searchParams.get('vendorId')
  const limit         = Math.min(parseInt(searchParams.get('limit') ?? '1000'), 5000)

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
    .limit(limit)

  if (status !== 'all')  query = query.eq('status', status)
  if (from)              query = query.gte('tx_date', from)
  if (to)                query = query.lte('tx_date', to)
  if (source !== 'all')  query = query.eq('source', source)
  if (bankAccountId)     query = query.eq('bank_account_id', bankAccountId)
  if (vendorId)          query = query.eq('vendor_id', vendorId)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? [] })
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
