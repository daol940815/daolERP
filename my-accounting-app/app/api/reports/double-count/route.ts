import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// GET /api/reports/double-count — 이중계상 상설 검사 (계획서 3단계 결정 3)
// 같은 지출이 두 경로로 비용에 잡히는 경우를 3방향으로 교차 검사한다.
//   A. 세금계산서와 결제매칭된 은행거래가 '비용'으로도 확정된 건 (확정 이중)
//   B. 비용으로 확정된 은행출금과 같은 거래처·같은 금액·±35일의 분류된 매입 세계 (유사 이중)
//   C. 법인카드 확정 건과 같은 사업자번호·같은 금액·±7일의 분류된 매입 세계 (병행 발행 이중)
// 검사 결과 0건 유지가 손익 신뢰의 방어선 — 분류 작업 후 수시로 실행한다.

const dayDiff = (a: string, b: string) =>
  Math.abs(new Date(a.slice(0, 10)).getTime() - new Date(b.slice(0, 10)).getTime()) / 86_400_000

export async function GET() {
  const admin = createAdminClient()

  const { data: accountList, error: ae } = await admin.from('accounts').select('id, code, name, type')
  if (ae) return NextResponse.json({ error: ae.message }, { status: 500 })
  const accounts = new Map((accountList ?? []).map(a => [a.id as string, a]))
  const isExpense = (id: string | null) => !!id && accounts.get(id)?.type === 'expense'

  const paysResult = await fetchAllRows<{ transaction_id: string }>((f, t) =>
    admin.from('tax_invoice_payments').select('transaction_id').range(f, t))
  if ('error' in paysResult) return NextResponse.json({ error: paysResult.error }, { status: 500 })
  const paidTx = new Set(paysResult.data.map(p => p.transaction_id))

  const txResult = await fetchAllRows<{ id: string; tx_date: string; description: string | null; counterparty_name: string | null; vendor_id: string | null; amount_out: number | null; confirmed_account_id: string | null }>((f, t) =>
    admin.from('transactions')
      .select('id, tx_date, description, counterparty_name, vendor_id, amount_out, confirmed_account_id')
      .not('confirmed_account_id', 'is', null)
      .range(f, t))
  if ('error' in txResult) return NextResponse.json({ error: txResult.error }, { status: 500 })

  const invResult = await fetchAllRows<{ id: string; issue_date: string; vendor_id: string | null; counterparty_name: string | null; counterparty_biz_number: string | null; total_amount: number; confirmed_account_id: string | null }>((f, t) =>
    admin.from('tax_invoices')
      .select('id, issue_date, vendor_id, counterparty_name, counterparty_biz_number, total_amount, confirmed_account_id')
      .eq('direction', 'purchase')
      .range(f, t))
  if ('error' in invResult) return NextResponse.json({ error: invResult.error }, { status: 500 })
  const invoices = invResult.data

  type Finding = { check: 'A' | 'B' | 'C'; date: string; label: string; amount: number; detail: string }
  const findings: Finding[] = []

  // ── A: 세계 결제매칭 + 비용 확정 ──
  for (const t of txResult.data) {
    if (!paidTx.has(t.id) || !isExpense(t.confirmed_account_id)) continue
    findings.push({
      check: 'A', date: t.tx_date.slice(0, 10),
      label: (t.counterparty_name || t.description || '').slice(0, 30),
      amount: t.amount_out ?? 0,
      detail: `세계 매칭 거래가 [${accounts.get(t.confirmed_account_id!)?.name}] 비용으로도 확정됨 — 상계(2001)로 변경 필요`,
    })
  }

  // ── B: 비용 확정 출금 ↔ 분류된 매입 세계 (거래처+금액+±35일) ──
  const invByVendorAmt = new Map<string, typeof invoices>()
  for (const i of invoices) {
    if (!i.vendor_id || !i.confirmed_account_id) continue
    const key = `${i.vendor_id}|${i.total_amount}`
    const arr = invByVendorAmt.get(key) ?? []
    arr.push(i)
    invByVendorAmt.set(key, arr)
  }
  for (const t of txResult.data) {
    if (paidTx.has(t.id) || !isExpense(t.confirmed_account_id)) continue
    if (!t.vendor_id || !(t.amount_out ?? 0)) continue
    const cand = (invByVendorAmt.get(`${t.vendor_id}|${t.amount_out}`) ?? [])
      .find(i => dayDiff(t.tx_date, i.issue_date) <= 35)
    if (cand) {
      findings.push({
        check: 'B', date: t.tx_date.slice(0, 10),
        label: (t.counterparty_name || t.description || '').slice(0, 30),
        amount: t.amount_out ?? 0,
        detail: `동일 거래처·금액 매입 세계(${cand.issue_date.slice(0, 10)})가 이미 비용 분류됨 — 출금은 미지급금 상계 권장`,
      })
    }
  }

  // ── C: 법인카드 확정 ↔ 분류된 매입 세계 (사업자번호+금액+±7일) ──
  const digits = (v: string | null) => (v ?? '').replace(/\D/g, '')
  const invByBizAmt = new Map<string, typeof invoices>()
  for (const i of invoices) {
    const b = digits(i.counterparty_biz_number)
    if (!b || !i.confirmed_account_id) continue
    const key = `${b}|${i.total_amount}`
    const arr = invByBizAmt.get(key) ?? []
    arr.push(i)
    invByBizAmt.set(key, arr)
  }
  const ceResult = await fetchAllRows<{ id: string; tx_date: string; merchant_name: string | null; merchant_biz_number: string | null; approved_amount: number; classify_status: string }>((f, t) =>
    admin.from('card_expenses')
      .select('id, tx_date, merchant_name, merchant_biz_number, approved_amount, classify_status')
      .eq('classify_status', 'confirmed')
      .range(f, t))
  if ('error' in ceResult) return NextResponse.json({ error: ceResult.error }, { status: 500 })
  for (const r of ceResult.data) {
    const b = digits(r.merchant_biz_number)
    if (!b) continue
    const cand = (invByBizAmt.get(`${b}|${r.approved_amount}`) ?? [])
      .find(i => dayDiff(r.tx_date, i.issue_date) <= 7)
    if (cand) {
      findings.push({
        check: 'C', date: r.tx_date.slice(0, 10),
        label: (r.merchant_name ?? '').slice(0, 30),
        amount: r.approved_amount,
        detail: `카드 비용과 매입 세계(${cand.issue_date.slice(0, 10)})가 병행 발행으로 둘 다 분류됨 — 한쪽 확정 해제 필요`,
      })
    }
  }

  findings.sort((a, b) => a.check.localeCompare(b.check) || b.amount - a.amount)
  return NextResponse.json({
    findings,
    summary: {
      A: findings.filter(f => f.check === 'A').length,
      B: findings.filter(f => f.check === 'B').length,
      C: findings.filter(f => f.check === 'C').length,
      total_amount: findings.reduce((s, f) => s + f.amount, 0),
    },
  })
}
