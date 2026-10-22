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

// ── 파일 자체에서 매출/매입·과세/면세 판별 ──────────────────
// 홈택스 목록조회 파일은 헤더 위에 두 줄의 단서를 갖는다.
//   0행: "사업자 등록번호 | 701-88-00023 | 상호 | 주식회사 다올커머스"  ← 우리 회사
//   4행: "매출 전자(수정) 세금계산서 목록조회" / "매입 전자(수정) 계산서 목록조회"  ← 제목
// 방향은 제목의 매출/매입 + 우리 사업자번호가 공급자/공급받는자 어느 쪽에 있는지로
// 이중 확인한다. 둘이 어긋나면 저장하지 않고 사용자에게 묻는다.
// 과세/면세는 '세액' 컬럼 유무(양식)가 1차, 제목(세금계산서/계산서)은 교차 확인.
type Detected = {
  dirByTitle: 'sales' | 'purchase' | null
  taxByTitle: 'taxable' | 'exempt' | null
  title: string | null
  selfBiz: string | null
}

const BIZ_RE = /^\d{3}-\d{2}-\d{5}$/

function detectFromMeta(metaRows: unknown[][]): Detected {
  let title: string | null = null
  let selfBiz: string | null = null
  for (const row of metaRows) {
    const cells = row.map(c => String(c ?? '').trim())
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      if (!title && /목록\s*조회/.test(c) && /(매출|매입)/.test(c)) title = c
      if (!selfBiz && /^사업자\s*등록번호$/.test(c)) {
        const next = cells.slice(i + 1).find(v => v.length > 0) ?? ''
        if (BIZ_RE.test(next)) selfBiz = next
      }
    }
  }
  const dirByTitle = title ? (/매출/.test(title) ? 'sales' : /매입/.test(title) ? 'purchase' : null) : null
  const taxByTitle = title ? (/세금\s*계산서/.test(title) ? 'taxable' : /계산서/.test(title) ? 'exempt' : null) : null
  return { dirByTitle, taxByTitle, title, selfBiz }
}

function majority(values: string[]): string | null {
  const counts = new Map<string, number>()
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
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
//                      direction = sales|purchase, taxType = taxable|exempt  — 둘 다 선택(힌트).
// 매출/매입·과세/면세는 **파일에서 판별**한다(제목 행 + 우리 사업자번호 위치 + 세액 컬럼).
// 화면에서 보낸 값과 다르면 파일 쪽을 믿고 directionCorrected/taxTypeCorrected로 알린다.
// 사업자등록번호(우선) 또는 상호명으로 거래처를 자동 매칭/등록하고, 승인번호 기준으로 upsert 한다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()

  const formData     = await req.formData().catch(() => null)
  const file         = formData?.get('file') as File | null
  const reqDirRaw    = formData?.get('direction') as string | null
  const reqTaxRaw    = formData?.get('taxType') as string | null
  const reqDirection = reqDirRaw === 'sales' || reqDirRaw === 'purchase' ? reqDirRaw : null
  const reqTaxType   = reqTaxRaw === 'taxable' || reqTaxRaw === 'exempt' ? reqTaxRaw : null

  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })

  // 파일 파싱은 손상·비정형 파일에서 예외를 던질 수 있다 — 크래시("Failed to fetch") 대신 메시지 반환
  let header: unknown[] | null = null
  let dataRows: unknown[][] = []
  let metaRows: unknown[][] = []
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
        metaRows = rows.slice(0, headerIdx)
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

  // ── 과세/면세: 파일 양식으로 판별 ──
  // 홈택스 전자세금계산서(과세) 파일에는 '세액' 컬럼이 있고, 전자계산서(면세)에는 없다.
  const meta = detectFromMeta(metaRows)
  const detectedTaxType: 'taxable' | 'exempt' = col.tax >= 0 ? 'taxable' : 'exempt'
  const effectiveTaxType = detectedTaxType
  const taxTypeCorrected = reqTaxType !== null && reqTaxType !== effectiveTaxType

  // ── 매출/매입: 제목 행 + 우리 사업자번호 위치로 이중 판별 ──
  const supplierMajority  = majority(dataRows.map(r => String(r[col.supplierBiz]  ?? '').trim()))
  const recipientMajority = majority(dataRows.map(r => String(r[col.recipientBiz] ?? '').trim()))
  // 우리 사업자번호: 0행에서 읽은 값 우선. 없으면 "한쪽 컬럼에 압도적으로 반복되는 번호"로 추정.
  const selfBiz = meta.selfBiz
    ?? (supplierMajority && dataRows.every(r => String(r[col.supplierBiz] ?? '').trim() === supplierMajority) ? supplierMajority
      : recipientMajority && dataRows.every(r => String(r[col.recipientBiz] ?? '').trim() === recipientMajority) ? recipientMajority
      : null)
  const dirByBiz: 'sales' | 'purchase' | null =
    selfBiz && supplierMajority === selfBiz && recipientMajority !== selfBiz ? 'sales'
    : selfBiz && recipientMajority === selfBiz && supplierMajority !== selfBiz ? 'purchase'
    : null

  if (meta.dirByTitle && dirByBiz && meta.dirByTitle !== dirByBiz) {
    return NextResponse.json(
      { error: `파일 제목은 ${meta.dirByTitle === 'sales' ? '매출' : '매입'}인데 사업자번호 위치는 ${dirByBiz === 'sales' ? '매출' : '매입'}로 보입니다. 파일을 확인해주세요. (제목: ${meta.title})` },
      { status: 400 },
    )
  }
  const detectedDirection = meta.dirByTitle ?? dirByBiz ?? reqDirection
  if (!detectedDirection) {
    return NextResponse.json(
      { error: '매출/매입을 파일에서 판별하지 못했습니다. 매출 또는 매입 메뉴에서 업로드해주세요.' },
      { status: 400 },
    )
  }
  const direction: 'sales' | 'purchase' = detectedDirection
  const directionCorrected = reqDirection !== null && reqDirection !== direction

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
  // 전량을 페이지로 읽는다 — 단일 조회는 PostgREST max-rows(1000)에서 잘려, 1000번째 이후
  // 거래처를 못 보고 같은 사업자번호로 새 거래처를 만들었다 (2026-10-22 확인: 동명 100그룹 216행).
  const vendorsResult = await fetchAllRows<{ id: string; name: string; biz_number: string | null; type: string; default_account_id: string | null }>((f, t) =>
    admin.from('vendors').select('id, name, biz_number, type, default_account_id').range(f, t))
  if ('error' in vendorsResult) return NextResponse.json({ error: vendorsResult.error }, { status: 500 })
  const vendors = vendorsResult.data
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
    // 파일에서 판별한 구분 — 화면 선택과 달랐으면 Corrected에 값이 들어간다 (파일 쪽으로 저장됨)
    detected: { direction, taxType: effectiveTaxType, title: meta.title, selfBiz },
    directionCorrected: directionCorrected ? direction : null,
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
