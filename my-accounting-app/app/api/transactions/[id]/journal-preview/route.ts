import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildBankPosting, type BankTxForPosting } from '@/lib/journal/bank-posting'

export const dynamic = 'force-dynamic'

// GET /api/transactions/[id]/journal-preview
// 확정 전 예상 분개(차변/대변)를 계산해 반환한다. (저장하지 않음 — buildPosting과 동일 로직)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient()

  const { data: tx, error } = await admin
    .from('transactions')
    .select('id, tx_date, description, amount_in, amount_out, confirmed_account_id, vendor_id, transfer_pair_id, bank_accounts(gl_account_id)')
    .eq('id', params.id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let glAccountId = (tx.bank_accounts as { gl_account_id?: string | null } | null)?.gl_account_id ?? null
  if (!glAccountId) {
    const { data: def } = await admin.from('accounts').select('id').eq('code', '1001').single()
    glAccountId = (def?.id as string | undefined) ?? null
  }

  const draft = glAccountId
    ? buildBankPosting(tx as BankTxForPosting, glAccountId)
    : { error: '보통예금(1001) 계정을 찾을 수 없습니다.' }
  if ('error' in draft) return NextResponse.json({ preview: null, reason: draft.error })

  // 표시용: 계정 코드/명, 거래처명 해석
  const accIds = Array.from(new Set(draft.lines.map(l => l.account_id)))
  const vendorIds = Array.from(new Set(draft.lines.map(l => l.vendor_id).filter(Boolean) as string[]))
  const [{ data: accs }, { data: vens }] = await Promise.all([
    admin.from('accounts').select('id, code, name').in('id', accIds),
    vendorIds.length ? admin.from('vendors').select('id, name').in('id', vendorIds) : Promise.resolve({ data: [] }),
  ])
  const accMap = new Map((accs ?? []).map(a => [a.id as string, a]))
  const venMap = new Map((vens ?? []).map(v => [v.id as string, v.name as string]))

  const display = draft.lines.map(l => ({
    side: l.side,
    account_code: accMap.get(l.account_id)?.code ?? null,
    account_name: accMap.get(l.account_id)?.name ?? '(계정)',
    amount: l.amount,
    vendor_name: l.vendor_id ? (venMap.get(l.vendor_id) ?? null) : null,
  }))
  const debit = display.filter(d => d.side === 'debit').reduce((s, d) => s + d.amount, 0)
  const credit = display.filter(d => d.side === 'credit').reduce((s, d) => s + d.amount, 0)

  return NextResponse.json({
    preview: { entry_date: draft.entry_date, description: draft.description, lines: display },
    balanced: debit === credit && debit > 0,
    debit, credit,
  })
}
