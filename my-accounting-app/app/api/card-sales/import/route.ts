import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

// 카드 매출 상세내역 다운로드 파일 식별용 필수 컬럼 (단말기결제)
const TERMINAL_REQUIRED_COLS = ['거래일자', '거래유형', '카드번호', '승인번호', '금액']
// 수기결제(PG) 내역 다운로드 파일 식별용 필수 컬럼 — 승인/취소가 한 행에 같이 담겨있는 형식
const MANUAL_REQUIRED_COLS = ['결제일', '승인번호', '카드번호', '결제금액', '결제상태']

function findCol(header: unknown[], name: string): number {
  return header.findIndex(h => String(h ?? '').trim() === name)
}

function toNumber(v: unknown): number {
  const s = String(v ?? '').replace(/,/g, '').trim()
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function toDate(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

// '2026-05-14 16:34:06' 형태의 결제일/취소일자를 날짜·시간으로 분리
function splitDateTime(v: unknown): { date: string | null; time: string | null } {
  const s = String(v ?? '').trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/)
  if (!m) return { date: null, time: null }
  return { date: m[1], time: m[2] ?? null }
}

type ParsedRow = {
  tx_date: string
  tx_time: string | null
  transaction_type: 'approval' | 'cancel'
  approval_number: string
  card_number: string | null
  acquirer: string | null
  amount: number
  supply_amount: number
  tax_amount: number
  processing_status: string | null
  deposit_expected_date: string | null
  cancelled_at: string | null
  settlement_status: string | null
}

// POST /api/card-sales/import
// multipart/form-data: file (카드 매출 상세내역 XLSX 다운로드 파일)
// 카드번호 기준으로 거래처를 자동 매칭하고, (승인번호, 거래유형) 기준으로 upsert 한다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()

  const formData = await req.formData().catch(() => null)
  const file     = formData?.get('file') as File | null

  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const wb = XLSX.read(buffer, { type: 'buffer' })

  // 헤더 행을 가진 시트를 컬럼 패턴으로 탐색 (시트명/위치가 다를 수 있음, 단말기결제/수기결제 두 형식 모두 지원)
  let header: unknown[] | null = null
  let dataRows: unknown[][] = []
  let format: 'terminal' | 'manual' | null = null

  for (const wsName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wsName], { header: 1, raw: false, defval: '' })
    const headerIdx = rows.findIndex(row =>
      TERMINAL_REQUIRED_COLS.every(col => row.some(cell => String(cell ?? '').trim() === col)) ||
      MANUAL_REQUIRED_COLS.every(col => row.some(cell => String(cell ?? '').trim() === col))
    )
    if (headerIdx >= 0) {
      header = rows[headerIdx]
      dataRows = rows.slice(headerIdx + 1)
      format = TERMINAL_REQUIRED_COLS.every(col => header!.some(cell => String(cell ?? '').trim() === col))
        ? 'terminal'
        : 'manual'
      break
    }
  }

  if (!header || !format) {
    return NextResponse.json(
      { error: '인식할 수 없는 파일 형식입니다. 카드 매출 상세내역(단말기결제 또는 수기결제) 다운로드 파일을 업로드해주세요.' },
      { status: 400 },
    )
  }

  const parsed: ParsedRow[] = []
  let skipped = 0

  if (format === 'terminal') {
    const col = {
      txDate:      findCol(header, '거래일자'),
      txTime:      findCol(header, '거래시간'),
      txType:      findCol(header, '거래유형'),
      cardNumber:  findCol(header, '카드번호'),
      approval:    findCol(header, '승인번호'),
      acquirer:    findCol(header, '매입사'),
      amount:      findCol(header, '금액'),
      procStatus:  findCol(header, '처리현황'),
      depositDate: findCol(header, '입금예정'),
      cancelledAt: findCol(header, '취소일시'),
      settlement:  findCol(header, '정산상태'),
      supply:      findCol(header, '공급가액'),
      tax:         findCol(header, '세금'),
    }

    for (const row of dataRows) {
      const approvalNumber = String(row[col.approval] ?? '').trim()
      const txDate         = toDate(row[col.txDate])
      if (!approvalNumber || !txDate) { skipped++; continue }

      const txTypeRaw = String(row[col.txType] ?? '').trim()
      const transactionType: 'approval' | 'cancel' = txTypeRaw === '취소' ? 'cancel' : 'approval'

      parsed.push({
        tx_date: txDate,
        tx_time: String(row[col.txTime] ?? '').trim() || null,
        transaction_type: transactionType,
        approval_number: approvalNumber,
        card_number: String(row[col.cardNumber] ?? '').trim() || null,
        acquirer: String(row[col.acquirer] ?? '').trim() || null,
        amount: toNumber(row[col.amount]),
        supply_amount: toNumber(row[col.supply]),
        tax_amount: toNumber(row[col.tax]),
        processing_status: String(row[col.procStatus] ?? '').trim() || null,
        deposit_expected_date: toDate(row[col.depositDate]),
        cancelled_at: String(row[col.cancelledAt] ?? '').trim() || null,
        settlement_status: String(row[col.settlement] ?? '').trim() || null,
      })
    }
  } else {
    // 수기결제(PG) — 승인/취소 정보가 한 행에 같이 담겨 있으므로,
    // 취소금액이 있는 건은 기존 card_sales 스키마의 승인/취소 짝(동일 승인번호) 규칙에 맞춰 두 행으로 분리한다.
    const col = {
      payDate:      findCol(header, '결제일'),
      approval:     findCol(header, '승인번호'),
      acquirer:     findCol(header, '카드사'),
      cardNumber:   findCol(header, '카드번호'),
      amount:       findCol(header, '결제금액'),
      cancelAmount: findCol(header, '취소금액'),
      cancelDate:   findCol(header, '취소일자'),
      procStatus:   findCol(header, '결제상태'),
      settlement:   findCol(header, '최종상태'),
    }

    for (const row of dataRows) {
      const approvalNumber = String(row[col.approval] ?? '').trim()
      const { date: payDate, time: payTime } = splitDateTime(row[col.payDate])
      if (!approvalNumber || !payDate) { skipped++; continue }

      const cardNumber   = String(row[col.cardNumber] ?? '').trim() || null
      const acquirer     = String(row[col.acquirer] ?? '').trim() || null
      const procStatus   = String(row[col.procStatus] ?? '').trim() || null
      const settlement   = String(row[col.settlement] ?? '').trim() || null
      const cancelAmount = toNumber(row[col.cancelAmount])

      parsed.push({
        tx_date: payDate,
        tx_time: payTime,
        transaction_type: 'approval',
        approval_number: approvalNumber,
        card_number: cardNumber,
        acquirer,
        amount: toNumber(row[col.amount]),
        supply_amount: 0,
        tax_amount: 0,
        processing_status: procStatus,
        deposit_expected_date: null,
        cancelled_at: null,
        settlement_status: settlement,
      })

      if (cancelAmount > 0) {
        const cancelledAtRaw = String(row[col.cancelDate] ?? '').trim() || null
        const { date: cancelDate, time: cancelTime } = splitDateTime(row[col.cancelDate])

        parsed.push({
          tx_date: cancelDate ?? payDate,
          tx_time: cancelTime,
          transaction_type: 'cancel',
          approval_number: approvalNumber,
          card_number: cardNumber,
          acquirer,
          amount: -cancelAmount,
          supply_amount: 0,
          tax_amount: 0,
          processing_status: procStatus,
          deposit_expected_date: null,
          cancelled_at: cancelledAtRaw,
          settlement_status: settlement,
        })
      }
    }
  }

  if (!parsed.length) {
    return NextResponse.json({ error: '가져올 수 있는 데이터가 없습니다.', skipped }, { status: 400 })
  }

  // ── 거래처 자동 매칭 (카드번호 기준 — 상호명이 없어 신규 등록은 하지 않음) ──
  const { data: vendors } = await admin
    .from('vendors')
    .select('id, card_numbers')
    .not('card_numbers', 'eq', '{}')

  const vendorByCard = new Map<string, string>()
  for (const v of vendors ?? []) {
    for (const card of (v.card_numbers as string[] | null) ?? []) {
      if (card) vendorByCard.set(card, v.id as string)
    }
  }

  // 기존에 저장된 건의 vendor_id는 유지 (수동 보정값을 재업로드 시 덮어쓰지 않기 위함)
  const { data: existingRows } = await admin
    .from('card_sales')
    .select('approval_number, transaction_type, vendor_id')
    .in('approval_number', parsed.map(r => r.approval_number))
  const existingVendorMap = new Map(
    (existingRows ?? []).map(r => [`${r.approval_number}__${r.transaction_type}`, r.vendor_id as string | null]),
  )

  const rowsToUpsert = parsed.map(row => {
    const key = `${row.approval_number}__${row.transaction_type}`
    const existingVendorId = existingVendorMap.get(key)
    const vendorId = existingVendorId !== undefined && existingVendorId !== null
      ? existingVendorId
      : (row.card_number ? vendorByCard.get(row.card_number) : undefined) ?? null
    return { ...row, vendor_id: vendorId }
  })

  const { data: upserted, error } = await admin
    .from('card_sales')
    .upsert(rowsToUpsert, { onConflict: 'approval_number,transaction_type', ignoreDuplicates: false })
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    imported: upserted?.length ?? 0,
    skipped,
    total: dataRows.length,
  })
}
