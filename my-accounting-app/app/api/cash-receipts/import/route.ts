import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

// 홈택스 현금영수증 파일 식별용 필수 컬럼
// 발행(매출): 매출일시 컬럼이 있음
const SALES_REQUIRED_COLS    = ['매출일시', '승인번호', '총금액', '거래구분']
// 수취(매입): 매입일시 컬럼이 있음
const PURCHASE_REQUIRED_COLS = ['매입일시', '승인번호', '매입금액', '거래구분']

function findCol(header: unknown[], name: string): number {
  return header.findIndex(h => String(h ?? '').trim() === name)
}

function toNumber(v: unknown): number {
  const s = String(v ?? '').replace(/,/g, '').trim()
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : 0
}

// '2026-05-26 13:54:03' → { date: '2026-05-26', time: '13:54:03' }
function splitDateTime(v: unknown): { date: string | null; time: string | null } {
  const s = String(v ?? '').trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/)
  if (!m) return { date: null, time: null }
  return { date: m[1], time: m[2] ?? null }
}

type ParsedRow = {
  direction: 'sales' | 'purchase'
  tx_date: string
  tx_time: string | null
  transaction_type: 'approval' | 'cancel'
  approval_number: string
  counterparty_name: string | null
  counterparty_biz_number: string | null
  issue_type: string | null
  purpose_type: string | null
  deductible: boolean | null
  amount: number
  supply_amount: number
  tax_amount: number
  service_charge: number
}

// POST /api/cash-receipts/import
// multipart/form-data: file (홈택스 현금영수증 다운로드 파일)
// 헤더 시그니처로 발행(매출)/수취(매입)를 자동 감지하여 처리
export async function POST(req: NextRequest) {
  const admin = createAdminClient()

  const formData = await req.formData().catch(() => null)
  const file     = formData?.get('file') as File | null

  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const wb     = XLSX.read(buffer, { type: 'buffer' })

  let header:   unknown[] | null = null
  let dataRows: unknown[][]      = []
  let format:   'sales' | 'purchase' | null = null

  for (const wsName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wsName], { header: 1, raw: false, defval: '' })
    const headerIdx = rows.findIndex(row =>
      SALES_REQUIRED_COLS.every(col => row.some(cell => String(cell ?? '').trim() === col)) ||
      PURCHASE_REQUIRED_COLS.every(col => row.some(cell => String(cell ?? '').trim() === col))
    )
    if (headerIdx >= 0) {
      header   = rows[headerIdx]
      dataRows = rows.slice(headerIdx + 1)
      format   = SALES_REQUIRED_COLS.every(col => header!.some(cell => String(cell ?? '').trim() === col))
        ? 'sales'
        : 'purchase'
      break
    }
  }

  if (!header || !format) {
    return NextResponse.json(
      { error: '인식할 수 없는 파일 형식입니다. 홈택스에서 다운로드한 현금영수증 파일을 업로드해주세요.' },
      { status: 400 },
    )
  }

  const parsed: ParsedRow[] = []
  let skipped = 0

  if (format === 'sales') {
    const col = {
      txDateTime:  findCol(header, '매출일시'),
      approval:    findCol(header, '승인번호'),
      txType:      findCol(header, '거래구분'),
      issueType:   findCol(header, '발행구분'),
      purposeType: findCol(header, '용도구분'),
      supply:      findCol(header, '공급가액'),
      tax:         findCol(header, '부가세'),
      service:     findCol(header, '봉사료'),
      amount:      findCol(header, '총금액'),
    }

    for (const row of dataRows) {
      const approvalNumber = String(row[col.approval] ?? '').trim()
      const { date, time } = splitDateTime(row[col.txDateTime])
      if (!approvalNumber || !date) { skipped++; continue }

      const txTypeRaw       = String(row[col.txType] ?? '').trim()
      const transactionType: 'approval' | 'cancel' = txTypeRaw === '취소거래' ? 'cancel' : 'approval'
      const rawAmount       = toNumber(row[col.amount])

      parsed.push({
        direction: 'sales',
        tx_date: date,
        tx_time: time,
        transaction_type: transactionType,
        approval_number: approvalNumber,
        counterparty_name: null,
        counterparty_biz_number: null,
        issue_type:   String(row[col.issueType]   ?? '').trim() || null,
        purpose_type: String(row[col.purposeType] ?? '').trim() || null,
        deductible: null,
        amount:         transactionType === 'cancel' ? -Math.abs(rawAmount) : Math.abs(rawAmount),
        supply_amount:  toNumber(row[col.supply]),
        tax_amount:     toNumber(row[col.tax]),
        service_charge: toNumber(row[col.service]),
      })
    }
  } else {
    const col = {
      txDateTime:  findCol(header, '매입일시'),
      approval:    findCol(header, '승인번호'),
      txType:      findCol(header, '거래구분'),
      counterName: findCol(header, '가맹점명'),
      counterBiz:  findCol(header, '가맹점사업자번호'),
      supply:      findCol(header, '공급가액'),
      tax:         findCol(header, '부가세'),
      service:     findCol(header, '봉사료'),
      amount:      findCol(header, '매입금액'),
      deductible:  findCol(header, '공제여부'),
    }

    for (const row of dataRows) {
      const approvalNumber = String(row[col.approval] ?? '').trim()
      const { date, time } = splitDateTime(row[col.txDateTime])
      if (!approvalNumber || !date) { skipped++; continue }

      const txTypeRaw       = String(row[col.txType] ?? '').trim()
      const transactionType: 'approval' | 'cancel' = txTypeRaw === '취소거래' ? 'cancel' : 'approval'
      const rawAmount       = toNumber(row[col.amount])
      const deductibleRaw   = String(row[col.deductible] ?? '').trim()

      parsed.push({
        direction: 'purchase',
        tx_date: date,
        tx_time: time,
        transaction_type: transactionType,
        approval_number: approvalNumber,
        counterparty_name:        String(row[col.counterName] ?? '').trim() || null,
        counterparty_biz_number:  String(row[col.counterBiz]  ?? '').trim() || null,
        issue_type:   null,
        purpose_type: null,
        deductible: deductibleRaw === '공제' ? true : deductibleRaw === '불공제' ? false : null,
        amount:         transactionType === 'cancel' ? -Math.abs(rawAmount) : Math.abs(rawAmount),
        supply_amount:  toNumber(row[col.supply]),
        tax_amount:     toNumber(row[col.tax]),
        service_charge: toNumber(row[col.service]),
      })
    }
  }

  if (!parsed.length) {
    return NextResponse.json({ error: '가져올 수 있는 데이터가 없습니다.', skipped }, { status: 400 })
  }

  // ── 거래처 자동 매칭 (매입: 가맹점사업자번호 기준) ──
  const bizNumbers = Array.from(new Set(
    parsed
      .filter(r => r.direction === 'purchase' && r.counterparty_biz_number)
      .map(r => r.counterparty_biz_number!),
  ))

  const vendorByBiz = new Map<string, string>()
  if (bizNumbers.length) {
    const { data: vendors } = await admin
      .from('vendors')
      .select('id, biz_number')
      .in('biz_number', bizNumbers)
    for (const v of vendors ?? []) {
      if (v.biz_number) vendorByBiz.set(v.biz_number as string, v.id as string)
    }
  }

  // 기존에 저장된 건의 vendor_id는 유지 (수동 보정값을 재업로드 시 덮어쓰지 않기 위함)
  // 승인번호 목록을 청크로 나눠 페이지네이션 조회 (.in() 결과도 PostgREST max-rows(1000)에 걸리므로)
  const approvalNumbers = Array.from(new Set(parsed.map(r => r.approval_number)))
  const existingRows: { approval_number: string; transaction_type: string; direction: string; vendor_id: string | null }[] = []
  for (let i = 0; i < approvalNumbers.length; i += 500) {
    const chunk = approvalNumbers.slice(i, i + 500)
    const r = await fetchAllRows<{ approval_number: string; transaction_type: string; direction: string; vendor_id: string | null }>((rFrom, rTo) =>
      admin
        .from('cash_receipts')
        .select('approval_number, transaction_type, direction, vendor_id')
        .in('approval_number', chunk)
        .range(rFrom, rTo),
    )
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
    existingRows.push(...r.data)
  }
  const existingVendorMap = new Map(
    existingRows.map(r => [
      `${r.approval_number}__${r.transaction_type}__${r.direction}`,
      r.vendor_id,
    ]),
  )

  const rowsToUpsert = parsed.map(row => {
    const key            = `${row.approval_number}__${row.transaction_type}__${row.direction}`
    const existingVendorId = existingVendorMap.get(key)
    const vendorId = existingVendorId !== undefined && existingVendorId !== null
      ? existingVendorId
      : (row.counterparty_biz_number ? vendorByBiz.get(row.counterparty_biz_number) : undefined) ?? null
    return { ...row, vendor_id: vendorId }
  })

  const { data: upserted, error } = await admin
    .from('cash_receipts')
    .upsert(rowsToUpsert, { onConflict: 'approval_number,transaction_type,direction', ignoreDuplicates: false })
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const fileKeys = new Set(parsed.map(r => `${r.approval_number}__${r.transaction_type}__${r.direction}`))
  const updated = Array.from(fileKeys).filter(k => existingVendorMap.has(k)).length
  const created = fileKeys.size - updated

  return NextResponse.json({
    imported: upserted?.length ?? 0,
    created,
    updated,
    skipped,
    total: dataRows.length,
    format,
  })
}
