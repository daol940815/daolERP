import type { SupabaseClient } from '@supabase/supabase-js'

// 목록/상세 API에서 공통으로 사용하는 세금계산서 select — 결제 연결 내역(payments)을
// 함께 내려줘서 한 계산서에 여러 거래내역이 부분금액으로 연결된 경우도 화면에서 바로 표현한다.
export const TAX_INVOICE_SELECT = `
  id, approval_number, issue_date, issued_date, direction, tax_type,
  vendor_id, counterparty_name, counterparty_biz_number,
  supply_amount, tax_amount, total_amount, item_name, note,
  matched_transaction_id, payment_status, payment_memo,
  confirmed_account_id,
  created_at, updated_at,
  matched_transaction:transactions!matched_transaction_id (
    tx_date, amount_in, amount_out, account_alias,
    bank_accounts ( bank_name, account_number, alias )
  ),
  payments:tax_invoice_payments (
    id, amount, transaction_id, created_at,
    transaction:transactions (
      tx_date, description, counterparty_name, amount_in, amount_out, account_alias,
      bank_accounts ( bank_name, account_number, alias )
    )
  )
`

type Admin = SupabaseClient

// 결제 연결 내역 합계로 payment_status·matched_transaction_id(최근 연결 거래, 표시용)를 재계산
export async function recalcInvoiceStatus(admin: Admin, invoiceId: string) {
  const { data: invoice } = await admin
    .from('tax_invoices')
    .select('total_amount')
    .eq('id', invoiceId)
    .single()
  if (!invoice) return

  const { data: payments } = await admin
    .from('tax_invoice_payments')
    .select('transaction_id, amount, created_at')
    .eq('tax_invoice_id', invoiceId)
    .order('created_at', { ascending: false })

  const paidTotal = (payments ?? []).reduce((s, p) => s + (p.amount as number), 0)
  // 음수(수정) 계산서는 상계 연결(음수 금액)이 총액에 도달해야 확인됨 —
  // 부호 없이 비교하면 연결 0원일 때도 0 >= 음수총액이라 잘못 matched가 된다
  const total = invoice.total_amount as number
  const status = total >= 0
    ? (paidTotal >= total ? 'matched' : 'unmatched')
    : (paidTotal <= total ? 'matched' : 'unmatched')
  const latestTransactionId = (payments?.[0]?.transaction_id as string | undefined) ?? null

  await admin
    .from('tax_invoices')
    .update({ payment_status: status, matched_transaction_id: latestTransactionId })
    .eq('id', invoiceId)
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

    const { data: vendor } = await admin
      .from('vendors')
      .select('name, match_aliases, biz_number')
      .eq('id', inv.vendor_id)
      .single()
    if (!vendor) return

    // ② 입금자명/적요 → 별칭 자동 저장
    const alias = ((tx.counterparty_name as string | null) ?? (tx.description as string | null) ?? '').trim()
    const existing = (vendor.match_aliases as string[] | null) ?? []
    const updates: Record<string, unknown> = {}
    if (alias.length >= 2 && alias !== vendor.name && !existing.includes(alias)) {
      updates.match_aliases = [...existing, alias]
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
    .upsert({ tax_invoice_id: invoiceId, transaction_id: transactionId, amount }, { onConflict: 'tax_invoice_id,transaction_id' })
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
  return { ok: true }
}

export async function removeInvoicePayment(admin: Admin, invoiceId: string, paymentId: string) {
  await admin.from('tax_invoice_payments').delete().eq('id', paymentId).eq('tax_invoice_id', invoiceId)
  await recalcInvoiceStatus(admin, invoiceId)
}

export async function clearInvoicePayments(admin: Admin, invoiceId: string) {
  await admin.from('tax_invoice_payments').delete().eq('tax_invoice_id', invoiceId)
  await recalcInvoiceStatus(admin, invoiceId)
}
