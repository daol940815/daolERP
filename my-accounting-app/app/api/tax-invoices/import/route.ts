import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// 홈택스 "전자(세금)계산서 목록조회" 다운로드 파일 식별용 필수 컬럼
const REQUIRED_COLS = ['작성일자', '승인번호', '공급자사업자등록번호', '공급받는자사업자등록번호', '합계금액']

function findCol(header: unknown[], name: string): number {
  return header.findIndex(h => String(h ?? '').trim() === name)
}

function toNumber(v: unknown): number {
  const s = String(v ?? '').replace(/,/g, '').trim()
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

function toDate(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

type ParsedRow = {
  approval_number: string
  issue_date: string
  issued_date: string | null
  direction: 'sales' | 'purchase'
  tax_type: 'taxable' | 'exempt'
  counterparty_name: string | null
  counterparty_biz_number: string | null
  supply_amount: number
  tax_amount: number
  total_amount: number
  item_name: string | null
  note: string | null
}

function matchAccount(
  text: string,
  accounts: { id: string; keywords: string[] }[],
): string | null {
  const normalized = text.toLowerCase()
  for (const acc of accounts) {
    if ((acc.keywords ?? []).some(kw => kw && normalized.includes(kw.toLowerCase()))) return acc.id
  }
  return null
}

// POST /api/tax-invoices/import
// multipart/form-data: file (홈택스 전자(세금)계산서 목록조회 XLS/XLSX 다운로드 파일)
//                      direction = sales|purchase, taxType = taxable|exempt
// 사업자등록번호(우선) 또는 상호명으로 거래처를 자동 매칭/등록하고, 승인번호 기준으로 upsert 한다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()

  const formData  = await req.formData().catch(() => null)
  const file      = formData?.get('file') as File | null
  const direction = formData?.get('direction') as string | null
  const taxType   = formData?.get('taxType') as string | null

  if (!file)                                              return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  if (direction !== 'sales' && direction !== 'purchase')  return NextResponse.json({ error: 'direction 값이 올바르지 않습니다.' }, { status: 400 })
  if (taxType !== 'taxable' && taxType !== 'exempt')      return NextResponse.json({ error: 'taxType 값이 올바르지 않습니다.' }, { status: 400 })

  // 파일 파싱은 손상·비정형 파일에서 예외를 던질 수 있다 — 크래시("Failed to fetch") 대신 메시지 반환
  let header: unknown[] | null = null
  let dataRows: unknown[][] = []
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const wb = XLSX.read(buffer, { type: 'buffer' })

    // 헤더 행을 가진 시트를 컬럼 패턴으로 탐색 (시트명/위치가 다를 수 있음)
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
  } catch (e) {
    return NextResponse.json(
      { error: `파일을 읽는 중 오류가 발생했습니다: ${e instanceof Error ? e.message : String(e)}. 홈택스에서 받은 엑셀 파일이 맞는지 확인해주세요.` },
      { status: 400 },
    )
  }

  if (!header) {
    return NextResponse.json(
      { error: '인식할 수 없는 파일 형식입니다. 홈택스 전자(세금)계산서 목록조회 다운로드 파일을 업로드해주세요.' },
      { status: 400 },
    )
  }

  const col = {
    issueDate:    findCol(header, '작성일자'),
    issuedDate:   findCol(header, '발급일자'),
    approval:     findCol(header, '승인번호'),
    supplierBiz:  findCol(header, '공급자사업자등록번호'),
    recipientBiz: findCol(header, '공급받는자사업자등록번호'),
    total:        findCol(header, '합계금액'),
    supply:       findCol(header, '공급가액'),
    tax:          findCol(header, '세액'),
    note:         findCol(header, '비고'),
    item:         findCol(header, '품목명'),
  }
  // 사업자등록번호 컬럼 2칸 뒤가 상호 (사업자등록번호 | 종사업장번호 | 상호)
  const supplierNameIdx  = col.supplierBiz  + 2
  const recipientNameIdx = col.recipientBiz + 2

  // 과세/면세는 탭 선택이 아니라 파일 양식으로 판별한다:
  // 홈택스 전자세금계산서(과세) 파일에는 '세액' 컬럼이 있고, 전자계산서(면세)에는 없다.
  // 면세 파일을 과세 탭에 올리는 실수(화환 계산서 등)를 여기서 바로잡는다.
  const detectedTaxType: 'taxable' | 'exempt' = col.tax >= 0 ? 'taxable' : 'exempt'
  const taxTypeCorrected = detectedTaxType !== taxType
  const effectiveTaxType = detectedTaxType

  // "우리 회사" 사업자번호 추정 — 선택한 방향 기준 자기 쪽 컬럼에서 가장 많이 등장하는 값
  const selfBizCounts = new Map<string, number>()
  for (const row of dataRows) {
    const selfBiz = String(row[direction === 'sales' ? col.supplierBiz : col.recipientBiz] ?? '').trim()
    if (selfBiz) selfBizCounts.set(selfBiz, (selfBizCounts.get(selfBiz) ?? 0) + 1)
  }
  const selfBiz = Array.from(selfBizCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const parsed: ParsedRow[] = []
  let skipped = 0
  let mismatched = 0   // 선택한 매출/매입 방향과 사업자번호 위치가 어긋나는 행 (잘못된 메뉴에 업로드했을 가능성)

  for (const row of dataRows) {
    const approvalNumber = String(row[col.approval] ?? '').trim()
    const issueDate      = toDate(row[col.issueDate])
    if (!approvalNumber || !issueDate) { skipped++; continue }

    const supplierBiz  = String(row[col.supplierBiz]  ?? '').trim()
    const recipientBiz = String(row[col.recipientBiz] ?? '').trim()
    const ourBiz       = direction === 'sales' ? supplierBiz : recipientBiz
    if (selfBiz && ourBiz && ourBiz !== selfBiz) mismatched++

    const counterpartyBiz  = direction === 'sales' ? recipientBiz : supplierBiz
    const counterpartyName = String(row[direction === 'sales' ? recipientNameIdx : supplierNameIdx] ?? '').trim() || null

    parsed.push({
      approval_number: approvalNumber,
      issue_date: issueDate,
      issued_date: toDate(row[col.issuedDate]),
      direction: direction as 'sales' | 'purchase',
      tax_type: effectiveTaxType,
      counterparty_name: counterpartyName,
      counterparty_biz_number: counterpartyBiz || null,
      supply_amount: toNumber(row[col.supply]),
      tax_amount: toNumber(row[col.tax]),
      total_amount: toNumber(row[col.total]),
      item_name: String(row[col.item] ?? '').trim() || null,
      note: String(row[col.note] ?? '').trim() || null,
    })
  }

  if (!parsed.length) {
    return NextResponse.json({ error: '가져올 수 있는 데이터가 없습니다.', skipped }, { status: 400 })
  }

  try {
  // ── 계정과목 자동분류용 계정 로드 (매입 → expense, 매출 → income) ──────
  const classifyType = direction === 'purchase' ? 'expense' : 'income'
  const { data: classifyAccs } = await admin
    .from('accounts')
    .select('id, keywords')
    .eq('type', classifyType)
    .eq('is_active', true)
    .order('code')
  const classifyAccounts: { id: string; keywords: string[] }[] = (classifyAccs ?? []).map(a => ({
    id: a.id as string,
    keywords: (a.keywords ?? []) as string[],
  }))

  // ── 거래처 자동 매칭/등록 (사업자번호 우선, 없으면 상호명) ──────────
  const { data: vendors } = await admin.from('vendors').select('id, name, biz_number, type, default_account_id')
  const vendorByBiz  = new Map<string, { id: string; type: string }>()
  const vendorByName = new Map<string, { id: string; type: string }>()
  const vendorDefaultAcc = new Map<string, string>()   // vendor_id → default_account_id
  for (const v of vendors ?? []) {
    if (v.biz_number) vendorByBiz.set(v.biz_number as string, { id: v.id as string, type: v.type as string })
    vendorByName.set((v.name as string).trim().toLowerCase(), { id: v.id as string, type: v.type as string })
    if (v.default_account_id) vendorDefaultAcc.set(v.id as string, v.default_account_id as string)
  }

  // ── 거래처별 확정 이력 (과반 계정) — 자동분류 최우선 추천 재료 ──────────
  // 같은 방향(sales/purchase)의 확정된 계산서를 거래처별로 집계해 과반 계정을 구한다.
  const histResult = await fetchAllRows<{ vendor_id: string; confirmed_account_id: string }>((f, t) =>
    admin.from('tax_invoices')
      .select('vendor_id, confirmed_account_id')
      .eq('direction', direction)
      .not('vendor_id', 'is', null)
      .not('confirmed_account_id', 'is', null)
      .range(f, t),
  )
  const vendorHistory = new Map<string, string>()   // vendor_id → 과반 계정
  if (!('error' in histResult)) {
    const counts = new Map<string, Map<string, number>>()
    for (const h of histResult.data) {
      const c = counts.get(h.vendor_id) ?? new Map<string, number>()
      c.set(h.confirmed_account_id, (c.get(h.confirmed_account_id) ?? 0) + 1)
      counts.set(h.vendor_id, c)
    }
    for (const [vid, c] of Array.from(counts.entries())) {
      let best: [string, number] | null = null
      let total = 0
      c.forEach((n, acc) => { total += n; if (!best || n > best![1]) best = [acc, n] })
      if (best && (best as [string, number])[1] * 2 > total) vendorHistory.set(vid, (best as [string, number])[0])
    }
  }

  const desiredType = direction === 'sales' ? 'customer' : 'vendor'
  const newVendorRows: { name: string; biz_number: string | null; type: string }[] = []
  const seenNew = new Set<string>()
  const typeUpgrades = new Set<string>()

  for (const row of parsed) {
    if (!row.counterparty_name) continue
    const key = row.counterparty_biz_number ?? row.counterparty_name.toLowerCase()

    const existing = (row.counterparty_biz_number ? vendorByBiz.get(row.counterparty_biz_number) : undefined)
      ?? vendorByName.get(row.counterparty_name.toLowerCase())

    if (existing) {
      if (existing.type !== desiredType && existing.type !== 'both') typeUpgrades.add(existing.id)
      continue
    }
    if (seenNew.has(key)) continue
    seenNew.add(key)
    newVendorRows.push({ name: row.counterparty_name, biz_number: row.counterparty_biz_number, type: desiredType })
  }

  let vendorsCreated = 0
  if (newVendorRows.length) {
    const { data: inserted } = await admin.from('vendors').insert(newVendorRows).select('id, name, biz_number, type')
    vendorsCreated = inserted?.length ?? 0
    for (const v of inserted ?? []) {
      if (v.biz_number) vendorByBiz.set(v.biz_number as string, { id: v.id as string, type: v.type as string })
      vendorByName.set((v.name as string).trim().toLowerCase(), { id: v.id as string, type: v.type as string })
    }
  }
  if (typeUpgrades.size) {
    await admin.from('vendors').update({ type: 'both' }).in('id', Array.from(typeUpgrades))
  }

  // 기존에 저장된 건의 vendor_id/confirmed_account_id는 유지 (수동 보정값을 재업로드 시 덮어쓰지 않기 위함)
  // 승인번호 목록을 청크로 나눠 페이지네이션 조회 (.in() 결과도 PostgREST max-rows(1000)에 걸리므로)
  const approvalNumbers = Array.from(new Set(parsed.map(r => r.approval_number)))
  const existingRows: { approval_number: string; vendor_id: string | null; confirmed_account_id: string | null }[] = []
  for (let i = 0; i < approvalNumbers.length; i += 500) {
    const chunk = approvalNumbers.slice(i, i + 500)
    const r = await fetchAllRows<{ approval_number: string; vendor_id: string | null; confirmed_account_id: string | null }>((rFrom, rTo) =>
      admin
        .from('tax_invoices')
        .select('approval_number, vendor_id, confirmed_account_id')
        .in('approval_number', chunk)
        .range(rFrom, rTo),
    )
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
    existingRows.push(...r.data)
  }
  const existingMap = new Map(
    existingRows.map(r => [
      r.approval_number,
      { vendor_id: r.vendor_id, confirmed_account_id: r.confirmed_account_id },
    ]),
  )

  // ── 세금계산서 upsert (승인번호 기준 — 재업로드 시 금액·날짜 등은 갱신, 매칭/확인 상태는 유지) ──
  const rowsToUpsert = parsed.map(row => {
    const existing = existingMap.get(row.approval_number)

    const vendorId = (existing?.vendor_id != null)
      ? existing.vendor_id
      : ((row.counterparty_biz_number ? vendorByBiz.get(row.counterparty_biz_number) : undefined)
          ?? (row.counterparty_name ? vendorByName.get(row.counterparty_name.toLowerCase()) : undefined))?.id ?? null

    // 자동분류 우선순위 (매입 일괄 분류 화면과 동일):
    //   ① 기존 확정값 유지 → ② 거래처 확정 이력 과반 → ③ 거래처 기본계정 → ④ 품목 키워드
    //   (자동은 채움까지만 — 최종 확정은 사용자. confirmed_account_id는 추천 채움값)
    let confirmedAccountId: string | null = existing?.confirmed_account_id ?? null
    if (confirmedAccountId == null && vendorId) {
      confirmedAccountId = vendorHistory.get(vendorId) ?? vendorDefaultAcc.get(vendorId) ?? null
    }
    if (confirmedAccountId == null && classifyAccounts.length > 0) {
      const searchText = [row.item_name, row.counterparty_name, row.note].filter(Boolean).join(' ')
      confirmedAccountId = matchAccount(searchText, classifyAccounts)
    }

    return { ...row, vendor_id: vendorId, confirmed_account_id: confirmedAccountId }
  })

  const { data: upserted, error } = await admin
    .from('tax_invoices')
    .upsert(rowsToUpsert, { onConflict: 'approval_number', ignoreDuplicates: false })
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 신규 vs 기존갱신(중복) — 승인번호 기준
  const updated = approvalNumbers.filter(a => existingMap.has(a)).length
  const created = approvalNumbers.length - updated

  return NextResponse.json({
    imported: upserted?.length ?? 0,
    created,
    updated,
    skipped,
    mismatched,
    vendorsCreated,
    total: dataRows.length,
    // 파일 양식으로 과세/면세를 판별해 탭 선택과 달랐던 경우 (자동 보정됨)
    taxTypeCorrected: taxTypeCorrected ? effectiveTaxType : null,
  })
  } catch (e) {
    // DB 처리 중 예외(제약 위반 등) — 크래시 대신 메시지 반환
    return NextResponse.json(
      { error: `저장 중 오류가 발생했습니다: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    )
  }
}
