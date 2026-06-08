import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

// 카드 매출 상세내역 다운로드 파일 식별용 필수 컬럼
const REQUIRED_COLS = ['거래일자', '거래유형', '카드번호', '승인번호', '금액']

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

  // 헤더 행을 가진 시트를 컬럼 패턴으로 탐색 (시트명/위치가 다를 수 있음)
  let header: unknown[] | null = null
  let dataRows: unknown[][] = []

  for (const wsName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wsName], { header: 1, raw: false, defval: '' })
    const headerIdx = rows.findIndex(row =>
      REQUIRED_COLS.every(col => row.some(cell => String(cell ?? '').trim() === col))
    )
    if (headerIdx >= 0) {
      header = rows[headerIdx]
      dataRows = rows.slice(headerIdx + 1)
      break
    }
  }

  if (!header) {
    return NextResponse.json(
      { error: '인식할 수 없는 파일 형식입니다. 카드 매출 상세내역 다운로드 파일을 업로드해주세요.' },
      { status: 400 },
    )
  }

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

  const parsed: ParsedRow[] = []
  let skipped = 0

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
