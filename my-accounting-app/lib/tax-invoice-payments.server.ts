import type { SupabaseClient } from '@supabase/supabase-js'
import { bankKeywordsColumnExists, bankKeywordsOf } from '@/lib/vendor-keywords.server'
import { FROM_ORDER_BLOCK, syncInvoicePaymentsFromOrders, syncOrderMatchesFromInvoices } from '@/lib/link-sync'

// 목록/상세 API에서 공통으로 사용하는 세금계산서 select — 결제 연결 내역(payments)을
// 함께 내려줘서 한 계산서에 여러 거래내역이 부분금액으로 연결된 경우도 화면에서 바로 표현한다.
export const TAX_INVOICE_SELECT = `
  id, approval_number, issue_date, issued_date, direction, tax_type,
  vendor_id, counterparty_name, counterparty_biz_number,
  supply_amount, tax_amount, total_amount, item_name, note,
  matched_transaction_id, payment_status, payment_memo,
  confirmed_account_id, classified_by,
  created_at, updated_at,
  matched_transaction:transactions!matched_transaction_id (
    tx_date, tx_time, amount_in, amount_out, account_alias,
    bank_accounts ( bank_name, account_number, alias )
  ),
  payments:tax_invoice_payments (
    id, amount, transaction_id, created_at, from_order_sync,
    transaction:transactions (
      tx_date, tx_time, description, counterparty_name, amount_in, amount_out, account_alias,
      bank_accounts ( bank_name, account_number, alias )
    )
  )
`

type Admin = SupabaseClient

// 결제 연결 내역 합계로 payment_status·matched_transaction_id(최근 연결 거래, 표시용)를 재계산
// 상태 3단계 (1302, 2026-11-17): 미확인(붙은 입금 없음) · 부분 확인(일부) · 확인됨(합계만큼, 또는 수동 확인).
//   payment_manual = 사람이 입금 연결과 무관하게 확인됨으로 바꾼 계산서 — 입금을 붙이거나 풀어도 확인됨을 지우지 않는다
//   (예전에는 수동 확인한 계산서에 입금을 일부 붙이면 미확인으로 되돌아갔다).
// 1302 미적용 환경: payment_manual 칸이 없으면 수동 확인 없음으로 보고, 'partial' 저장이 막히면 예전처럼 미확인으로 둔다.
export async function recalcInvoiceStatus(admin: Admin, invoiceId: string) {
  let manual = false
  let total: number
  const withManual = await admin.from('tax_invoices').select('total_amount, payment_manual').eq('id', invoiceId).single()
  if (withManual.error) {
    const { data: invoice } = await admin.from('tax_invoices').select('total_amount').eq('id', invoiceId).single()
    if (!invoice) return
    total = invoice.total_amount as number
  } else {
    if (!withManual.data) return
    total = withManual.data.total_amount as number
    manual = withManual.data.payment_manual === true
  }

  const { data: payments } = await admin
    .from('tax_invoice_payments')
    .select('transaction_id, amount, created_at')
    .eq('tax_invoice_id', invoiceId)
    .order('created_at', { ascending: false })

  const paidTotal = (payments ?? []).reduce((s, p) => s + (p.amount as number), 0)
  // 음수(수정) 계산서는 상계 연결(음수 금액)이 총액에 도달해야 확인됨 —
  // 부호 없이 비교하면 연결 0원일 때도 0 >= 음수총액이라 잘못 matched가 된다
  const full = total >= 0 ? paidTotal >= total : paidTotal <= total
  const some = total >= 0 ? paidTotal > 0 : paidTotal < 0
  const status = manual || full ? 'matched' : some ? 'partial' : 'unmatched'
  const latestTransactionId = (payments?.[0]?.transaction_id as string | undefined) ?? null

  const { error } = await admin
    .from('tax_invoices')
    .update({ payment_status: status, matched_transaction_id: latestTransactionId })
    .eq('id', invoiceId)
  if (error && status === 'partial') {
    // 1302 전 — 'partial'을 받지 않는다. 예전 2단계로 저장
    await admin.from('tax_invoices').update({ payment_status: 'unmatched', matched_transaction_id: latestTransactionId }).eq('id', invoiceId)
  }
}

type Result = { ok: true } | { ok: false; error: string }

// ── 매칭 학습 (거래처 마스터 정책 §7) ─────────────────────────
// 사용자가 계산서와 거래내역을 연결한 판단을 데이터로 축적한다:
//   ① 거래내역에 거래처 태깅 (다음 자동매칭에서 같은 거래처 거래로 즉시 후보화)
//   ② 입금자명/적요를 거래처 별칭으로 저장 (같은 표기가 다시 오면 자동 인식)
//   ③ 거래처에 사업자번호가 없으면 계산서의 번호로 백필 (최상위 매칭 키 확보)
// 부분결제 연결에서도 학습한다. 실패해도 연결 자체에는 영향을 주지 않는다.
async function learnFromPaymentLink(admin: Admin, invoiceId: string, transactionId: string) {
  try {
    const { data: inv } = await admin
      .from('tax_invoices')
      .select('vendor_id, counterparty_biz_number')
      .eq('id', invoiceId)
      .single()
    if (!inv?.vendor_id) return

    const { data: tx } = await admin
      .from('transactions')
      .select('vendor_id, counterparty_name, description')
      .eq('id', transactionId)
      .single()
    if (!tx) return

    // ① 거래내역 거래처 태깅 (비어 있을 때만 — 수동 지정 존중)
    if (!tx.vendor_id) {
      await admin.from('transactions').update({ vendor_id: inv.vendor_id }).eq('id', transactionId)
    }

    // 423: 통장 적요 표현은 통장 키워드(bank_keywords)에 학습한다 — 계산서 키워드와 섞지 않는다. 컬럼 없으면 옛 칸.
    const hasBank = await bankKeywordsColumnExists(admin)
    const { data: vendor } = await (admin
      .from('vendors')
      .select((hasBank ? 'name, match_aliases, biz_number, bank_keywords' : 'name, match_aliases, biz_number') as string)
      .eq('id', inv.vendor_id)
      .single() as unknown as PromiseLike<{ data: { name: string; match_aliases: string[] | null; biz_number: string | null; bank_keywords?: string[] | null } | null; error: { message: string } | null }>)
    if (!vendor) return

    // ② 입금자명/적요 → 통장 키워드 자동 저장
    const alias = ((tx.counterparty_name as string | null) ?? (tx.description as string | null) ?? '').trim()
    const existing = bankKeywordsOf(vendor as { bank_keywords?: string[] | null; match_aliases?: string[] | null }, hasBank)
    const updates: Record<string, unknown> = {}
    if (alias.length >= 2 && alias !== vendor.name && !existing.includes(alias)) {
      updates[hasBank ? 'bank_keywords' : 'match_aliases'] = [...existing, alias]
    }
    // ③ 사업자번호 백필
    if (!vendor.biz_number && inv.counterparty_biz_number) {
      updates.biz_number = inv.counterparty_biz_number
    }
    if (Object.keys(updates).length) {
      await admin.from('vendors').update(updates).eq('id', inv.vendor_id)
    }
  } catch {
    // 학습 실패는 조용히 무시 (연결 결과에 영향 없음)
  }
}

// 거래내역 1건을 계산서에 지정한 금액만큼 연결 (분할/합산 결제 공용)
// 같은 거래내역이 이미 연결되어 있으면 금액을 갱신한다.
// 수정(음수) 계산서는 음수 금액으로 연결한다(상계) — 순액 지급 시 원 계산서와
// 같은 출금에 함께 연결하면 거래 배분 합이 실제 출금액과 일치한다 (063).
export async function addInvoicePayment(
  admin: Admin, invoiceId: string, transactionId: string, amount: number,
): Promise<Result> {
  if (!Number.isFinite(amount) || amount === 0) {
    return { ok: false, error: '연결할 금액은 0이 될 수 없습니다.' }
  }

  const { data: invoice } = await admin
    .from('tax_invoices')
    .select('total_amount')
    .eq('id', invoiceId)
    .single()
  if (!invoice) return { ok: false, error: '세금계산서를 찾을 수 없습니다.' }

  const total = invoice.total_amount as number
  if (total >= 0 && amount < 0) {
    return { ok: false, error: '양수 계산서에는 양수 금액만 연결할 수 있습니다.' }
  }
  if (total < 0 && amount > 0) {
    return { ok: false, error: '수정(음수) 계산서는 음수 금액(상계)으로 연결됩니다. — 063 마이그레이션 적용 필요' }
  }

  const { data: existing } = await admin
    .from('tax_invoice_payments')
    .select('amount, transaction_id')
    .eq('tax_invoice_id', invoiceId)
  const alreadyPaid = (existing ?? [])
    .filter(p => p.transaction_id !== transactionId)
    .reduce((s, p) => s + (p.amount as number), 0)

  const remaining = total - alreadyPaid
  // 양수: 초과 금지 / 음수: 더 큰 음수(과상계) 금지
  if ((total >= 0 && amount > remaining) || (total < 0 && amount < remaining)) {
    return { ok: false, error: `합계금액을 초과합니다. (연결 가능 금액: ${remaining.toLocaleString('ko-KR')}원)` }
  }

  const { error } = await admin
    .from('tax_invoice_payments')
    .upsert({ tax_invoice_id: invoiceId, transaction_id: transactionId, amount, from_order_sync: false }, { onConflict: 'tax_invoice_id,transaction_id' })   // 직접 붙이면 직접 행(넘어온 행이 있었어도 덮어씀)
  if (error) {
    return {
      ok: false,
      error: /amount_check/.test(error.message)
        ? '수정(음수) 계산서 상계 연결에는 063 마이그레이션(payment_netting) 적용이 필요합니다.'
        : error.message,
    }
  }

  await recalcInvoiceStatus(admin, invoiceId)
  await learnFromPaymentLink(admin, invoiceId, transactionId)
  // 이 계산서가 주문에 연결돼 있으면 붙인 입금을 주문 수금으로도 넘긴다 (1302 — 매출 계산서만, 내부에서 판정)
  await syncOrderMatchesFromInvoices(admin, [invoiceId], '계산서 입금 연결')
  await syncInvoicePaymentsFromOrders(admin, [invoiceId])   // 직접 붙인 것과 겹치는 넘어온 행을 정리
  return { ok: true }
}

// 넘어온 입금(from_order_sync — 주문 수금에서 자동으로 넘어옴, 1302 2단계)은 여기서 지우지 않는다. 주문 쪽 수금을 풀면 함께 풀린다.
export async function removeInvoicePayment(admin: Admin, invoiceId: string, paymentId: string): Promise<Result> {
  const { data: row } = await admin.from('tax_invoice_payments').select('from_order_sync').eq('id', paymentId).eq('tax_invoice_id', invoiceId).maybeSingle()
  if (row?.from_order_sync) return { ok: false, error: FROM_ORDER_BLOCK }
  await admin.from('tax_invoice_payments').delete().eq('id', paymentId).eq('tax_invoice_id', invoiceId)
  await recalcInvoiceStatus(admin, invoiceId)
  await syncOrderMatchesFromInvoices(admin, [invoiceId], '계산서 입금 해제')   // 넘어갔던 주문 수금도 함께 푼다
  await syncInvoicePaymentsFromOrders(admin, [invoiceId])                       // 직접 행이 빠진 자리를 주문 수금이 채울 수 있으면 채운다
  return { ok: true }
}

// 전부 해제 — 직접 붙인 입금만 지운다. 넘어온 입금은 남는다(남은 것이 있으면 알려 준다).
export async function clearInvoicePayments(admin: Admin, invoiceId: string): Promise<Result> {
  await admin.from('tax_invoice_payments').delete().eq('tax_invoice_id', invoiceId).eq('from_order_sync', false)
  await recalcInvoiceStatus(admin, invoiceId)
  await syncOrderMatchesFromInvoices(admin, [invoiceId], '계산서 입금 해제')
  await syncInvoicePaymentsFromOrders(admin, [invoiceId])
  const { count } = await admin.from('tax_invoice_payments').select('id', { count: 'exact', head: true }).eq('tax_invoice_id', invoiceId).eq('from_order_sync', true)
  return (count ?? 0) > 0 ? { ok: false, error: `직접 붙인 입금은 해제했습니다. 남은 ${count}건은 ${FROM_ORDER_BLOCK}` } : { ok: true }
}
