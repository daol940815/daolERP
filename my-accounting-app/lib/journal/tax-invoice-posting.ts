import type { SupabaseClient } from '@supabase/supabase-js'
import { type JournalDraft, type JournalLineDraft } from './types'
import { postJournal, unpostJournal } from './posting'

// 세금계산서 자동분개 (업무 규칙). 저장은 post_journal(RPC)이 담당.
//
// 규칙(설계: docs/journal-design.md):
//   매출: (차) 매출채권(1101) 합계 / (대) 매출(확정계정) 공급가 + 부가세예수금(2003) 세액
//   매입: (차) 비용·자산(확정계정) 공급가 + 부가세대급금(1102) 세액 / (대) 미지급금(2001) 합계
//   * 면세(exempt)는 세액 0 → 부가세 라인 생략(합계로 처리). 균형은 total=main+vat 로 보장.
//   * 거래처(vendor_id)는 채권/채무 라인(매출채권 또는 미지급금)에 태깅 → 거래처별 원장.

export interface TaxInvoiceForPosting {
  id: string
  direction: 'sales' | 'purchase'
  tax_type: 'taxable' | 'exempt'
  issue_date: string
  supply_amount: number | null
  tax_amount: number | null
  total_amount: number | null
  confirmed_account_id: string | null
  vendor_id: string | null
  counterparty_name: string | null
  item_name: string | null
}

export interface TaxAccountIds {
  receivable: string   // 매출채권 1101
  payable: string      // 미지급금 2001
  vatPayable: string   // 부가세예수금 2003
  vatReceivable: string // 부가세대급금 1102
}

export function buildTaxInvoicePosting(
  inv: TaxInvoiceForPosting,
  acc: TaxAccountIds,
): JournalDraft | { error: string } {
  if (!inv.confirmed_account_id) return { error: '계정과목이 확정되지 않았습니다.' }
  const total = inv.total_amount ?? 0
  if (total === 0) return { error: '전기할 금액이 없습니다.' }

  // 음수(수정·취소 세금계산서)는 부호를 뒤집어 역분개한다(양수 금액 + 차/대 반전).
  const sign = total < 0 ? -1 : 1
  const absTotal = Math.abs(total)
  const vat = inv.tax_type === 'taxable' ? Math.abs(inv.tax_amount ?? 0) : 0
  const main = absTotal - vat
  if (main <= 0) return { error: '공급가액이 올바르지 않습니다.' }

  // 정상분개 기준 side. 음수면 차↔대 반전.
  const S = (normal: 'debit' | 'credit'): 'debit' | 'credit' =>
    sign > 0 ? normal : normal === 'debit' ? 'credit' : 'debit'

  const desc = inv.item_name?.trim() || inv.counterparty_name || null
  const lines: JournalLineDraft[] = []

  if (inv.direction === 'sales') {
    lines.push({ account_id: acc.receivable, side: S('debit'), amount: absTotal, vendor_id: inv.vendor_id ?? null })
    lines.push({ account_id: inv.confirmed_account_id, side: S('credit'), amount: main, vendor_id: null })
    if (vat > 0) lines.push({ account_id: acc.vatPayable, side: S('credit'), amount: vat, vendor_id: null })
  } else {
    lines.push({ account_id: inv.confirmed_account_id, side: S('debit'), amount: main, vendor_id: null })
    if (vat > 0) lines.push({ account_id: acc.vatReceivable, side: S('debit'), amount: vat, vendor_id: null })
    lines.push({ account_id: acc.payable, side: S('credit'), amount: absTotal, vendor_id: inv.vendor_id ?? null })
  }

  return {
    source_type: 'tax_invoice',
    source_id: inv.id,
    entry_date: inv.issue_date.slice(0, 10),
    description: desc,
    entry_type: 'normal',
    lines,
  }
}

async function resolveTaxAccounts(admin: SupabaseClient): Promise<TaxAccountIds | { error: string }> {
  const { data, error } = await admin.from('accounts').select('id, code').in('code', ['1101', '2001', '2003', '1102'])
  if (error) return { error: error.message }
  const byCode = new Map((data ?? []).map(a => [a.code as string, a.id as string]))
  const receivable = byCode.get('1101'); const payable = byCode.get('2001')
  const vatPayable = byCode.get('2003'); const vatReceivable = byCode.get('1102')
  if (!receivable || !payable || !vatPayable || !vatReceivable) {
    return { error: '필수 계정(매출채권1101·미지급금2001·부가세예수금2003·부가세대급금1102)을 찾을 수 없습니다.' }
  }
  return { receivable, payable, vatPayable, vatReceivable }
}

// 세금계산서 1건의 분개를 현재 상태에 맞춰 동기화한다(멱등).
//  - 계정 확정 & 금액>0 → 전기 / 그 외 → 전기 취소
export async function syncTaxInvoiceJournal(
  admin: SupabaseClient,
  invoiceId: string,
): Promise<{ ok: true } | { error: string }> {
  const { data: inv, error } = await admin
    .from('tax_invoices')
    .select('id, direction, tax_type, issue_date, supply_amount, tax_amount, total_amount, confirmed_account_id, vendor_id, counterparty_name, item_name')
    .eq('id', invoiceId)
    .single()
  if (error) return { error: error.message }

  const shouldPost = !!inv.confirmed_account_id && (inv.total_amount ?? 0) !== 0
  if (!shouldPost) {
    return unpostJournal(admin, 'tax_invoice', invoiceId).then(r => ('error' in r ? r : { ok: true as const }))
  }

  const acc = await resolveTaxAccounts(admin)
  if ('error' in acc) return acc

  const draft = buildTaxInvoicePosting(inv as TaxInvoiceForPosting, acc)
  if ('error' in draft) {
    await unpostJournal(admin, 'tax_invoice', invoiceId)
    return { error: draft.error }
  }
  const res = await postJournal(admin, draft)
  return 'error' in res ? res : { ok: true }
}
