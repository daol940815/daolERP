import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// GET /api/source/[type]/[id] — 분개의 원본 레코드 조회 (추적성 — 회계정책 §6)
// 원장에서 분개 → 원본으로 내려가는 마지막 고리. 읽기 전용.
// type: bank | card | card_sale | tax_invoice | manual
type Field = { label: string; value: string }
const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

export async function GET(
  _req: Request,
  { params }: { params: { type: string; id: string } },
) {
  const admin = createAdminClient()
  const { type, id } = params

  const fields: Field[] = []
  let title = ''
  let link: { href: string; label: string } | null = null

  if (type === 'bank') {
    const { data: t } = await admin
      .from('transactions')
      .select('tx_date, tx_time, description, counterparty_name, amount_in, amount_out, balance, account_alias, upload_log_id, bank_accounts(bank_name, account_number, alias), vendors(name)')
      .eq('id', id).maybeSingle()
    if (!t) return NextResponse.json({ error: '거래를 찾을 수 없습니다.' }, { status: 404 })
    const ba = t.bank_accounts as { bank_name?: string; account_number?: string; alias?: string } | null
    title = '통장 거래'
    fields.push(
      { label: '일시', value: `${t.tx_date}${t.tx_time ? ' ' + t.tx_time : ''}` },
      { label: '계좌', value: [ba?.alias || ba?.bank_name, ba?.account_number].filter(Boolean).join(' ') || (t.account_alias as string ?? '-') },
      { label: '적요', value: (t.description as string) || '-' },
      { label: '상대', value: (t.counterparty_name as string) || ((t.vendors as { name?: string } | null)?.name ?? '-') },
      { label: '입금', value: won(t.amount_in as number) },
      { label: '출금', value: won(t.amount_out as number) },
    )
    if (t.upload_log_id) {
      const { data: ul } = await admin
        .from('upload_logs').select('file_name, created_at').eq('id', t.upload_log_id).maybeSingle()
      if (ul) fields.push({ label: '업로드 파일', value: `${ul.file_name} (${String(ul.created_at).slice(0, 16).replace('T', ' ')})` })
    }
    link = { href: '/transactions', label: '거래 내역 화면으로' }
  } else if (type === 'card') {
    const { data: r } = await admin
      .from('card_expenses')
      .select('tx_date, tx_time, merchant_name, merchant_category, merchant_biz_number, approved_amount, cancel_amount, tax_amount, statement_status, classify_status, source_sheet, card_accounts(card_company, card_number, alias)')
      .eq('id', id).maybeSingle()
    if (!r) return NextResponse.json({ error: '카드 사용내역을 찾을 수 없습니다.' }, { status: 404 })
    const ca = r.card_accounts as { card_company?: string; card_number?: string; alias?: string } | null
    title = '법인카드 사용내역'
    fields.push(
      { label: '일시', value: `${r.tx_date}${r.tx_time ? ' ' + r.tx_time : ''}` },
      { label: '카드', value: `${ca?.alias || ca?.card_company || '-'} (끝 ${(ca?.card_number ?? '').replace(/\D/g, '').slice(-4)})` },
      { label: '가맹점', value: (r.merchant_name as string) || '-' },
      { label: '승인금액', value: won(r.approved_amount as number) },
      ...((r.cancel_amount as number) ? [{ label: '취소금액', value: won(r.cancel_amount as number) }] : []),
      ...((r.tax_amount as number) ? [{ label: '부가세', value: won(r.tax_amount as number) }] : []),
      { label: '상태', value: `${r.statement_status ?? '-'} / ${r.classify_status === 'confirmed' ? '확정' : '미확정'}` },
      ...(r.source_sheet ? [{ label: '원본 시트', value: String(r.source_sheet) }] : []),
    )
    link = { href: '/card-expenses', label: '법인카드 사용내역 화면으로' }
  } else if (type === 'card_sale') {
    const { data: r } = await admin
      .from('card_sales')
      .select('tx_date, tx_time, transaction_type, approval_number, card_number, acquirer, amount, settlement_status, vendors(name)')
      .eq('id', id).maybeSingle()
    if (!r) return NextResponse.json({ error: '카드매출을 찾을 수 없습니다.' }, { status: 404 })
    title = '카드결제내역(매출)'
    fields.push(
      { label: '일시', value: `${r.tx_date}${r.tx_time ? ' ' + r.tx_time : ''}` },
      { label: '구분', value: r.transaction_type === 'cancel' ? '취소' : '승인' },
      { label: '승인번호', value: String(r.approval_number ?? '-') },
      { label: '매입사', value: String(r.acquirer ?? '-') },
      { label: '카드번호', value: String(r.card_number ?? '-') },
      { label: '금액', value: won(r.amount as number) },
      ...(r.settlement_status ? [{ label: '정산상태', value: String(r.settlement_status) }] : []),
    )
    const vend = r.vendors as unknown as { name?: string } | { name?: string }[] | null
    const vendName = Array.isArray(vend) ? vend[0]?.name : vend?.name
    if (vendName) fields.push({ label: '매출처', value: vendName })
    link = { href: '/card-sales', label: '카드매출 화면으로' }
  } else if (type === 'tax_invoice') {
    const { data: r } = await admin
      .from('tax_invoices')
      .select('issue_date, direction, tax_type, approval_number, counterparty_name, counterparty_biz_number, item_name, supply_amount, tax_amount, total_amount, payment_status')
      .eq('id', id).maybeSingle()
    if (!r) return NextResponse.json({ error: '세금계산서를 찾을 수 없습니다.' }, { status: 404 })
    title = `${r.direction === 'sales' ? '매출' : '매입'} ${r.tax_type === 'taxable' ? '세금계산서' : '계산서(면세)'}`
    fields.push(
      { label: '발행일', value: String(r.issue_date).slice(0, 10) },
      { label: '승인번호', value: String(r.approval_number ?? '-') },
      { label: '거래처', value: `${r.counterparty_name ?? '-'} (${r.counterparty_biz_number ?? '-'})` },
      { label: '품목', value: String(r.item_name ?? '-') },
      { label: '공급가/세액/합계', value: `${won(r.supply_amount as number)} / ${won(r.tax_amount as number)} / ${won(r.total_amount as number)}` },
      { label: '결제상태', value: r.payment_status === 'matched' ? '매칭됨' : '미매칭' },
    )
    link = { href: `/tax-invoices/${r.direction}/${r.tax_type}`, label: '세금계산서 화면으로' }
  } else if (type === 'manual') {
    title = '수동 분개'
    fields.push({ label: '안내', value: '수동으로 입력된 분개입니다. 분개 현황 화면에서 확인하세요.' })
    link = { href: '/journal', label: '분개 현황으로' }
  } else {
    return NextResponse.json({ error: '알 수 없는 원본 유형입니다.' }, { status: 400 })
  }

  // 이 원본의 분개 요약 (해당되는 경우)
  if (type !== 'manual') {
    const { data: je } = await admin
      .from('journal_entries')
      .select('entry_no, entry_date, description, journal_lines(side, amount, accounts(code, name), vendors(name))')
      .eq('source_type', type).eq('source_id', id).maybeSingle()
    if (je) {
      const lines = (je.journal_lines as { side: string; amount: number; accounts: { code?: string; name?: string } | null; vendors: { name?: string } | null }[] | null ?? [])
        .map(l => `(${l.side === 'debit' ? '차' : '대'}) ${l.accounts?.name ?? '?'} ${won(l.amount)}${l.vendors?.name ? ` [${l.vendors.name}]` : ''}`)
      fields.push({ label: `분개 ${je.entry_no}`, value: lines.join('  ·  ') })
    }
  }

  return NextResponse.json({ title, fields, link })
}
