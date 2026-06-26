import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { syncCardExpenseJournal } from '@/lib/journal/card-posting'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// POST /api/card-expenses/import
// 법인카드 사용내역(하나카드 양식) 업로드.
// - 카드번호별로 card_accounts 자동 생성
// - 파일의 '계정과목'은 즉시 확정(confirmed), 비어 있으면 키워드 분류기가 제안(suggested→승인대기)
// - source_key(카드번호|이용일|이용시간|승인금액|가맹점명 + 동일키 순번)로 멱등 upsert
//   재업로드 시 사용자가 보정한 계정과목/분류는 보존한다.

const CARD_COMPANY = '하나카드' // 본 파서는 하나카드 양식 전용 (추후 카드사별 어댑터 추가)

// 하나카드 양식 식별용 필수 컬럼
const REQUIRED_COLS = ['카드번호', '이용일', '승인금액', '가맹점명']
const CHUNK = 500

function norm(name: unknown): string {
  return String(name ?? '').replace(/\s+/g, '').trim()
}
function findCol(header: unknown[], ...names: string[]): number {
  const targets = names.map(norm)
  return header.findIndex(h => targets.includes(norm(h)))
}
function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0
  const s = String(v ?? '').replace(/,/g, '').trim()
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : 0
}
function toStr(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s || null
}
// 이용일: '2026.03.31' / Date / 엑셀시리얼 / 'YYYY-MM-DD' 처리
function toDateStr(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' && v > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const s = String(v ?? '').trim()
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return null
}
// 이용시간: '08:46' / Date / 엑셀 시간 → 'HH:MM'
function toTimeStr(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(11, 16)
  const s = String(v ?? '').trim()
  const m = s.match(/(\d{1,2}):(\d{2})/)
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`
  return null
}

// 키워드 분류기 (classifier.server.ts와 동일 로직: 가장 긴 키워드 우선)
function classifyByKeywords(
  text: string,
  accountsWithKw: { id: string; keywords: string[] }[],
): { id: string; keyword: string } | null {
  const t = text.toLowerCase()
  let best: { id: string; keyword: string } | null = null
  for (const a of accountsWithKw) {
    for (const kw of a.keywords) {
      if (kw && t.includes(kw.toLowerCase()) && (!best || kw.length > best.keyword.length)) {
        best = { id: a.id, keyword: kw }
      }
    }
  }
  return best
}

export async function POST(req: NextRequest) {
  const admin = createAdminClient()

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('file') as File | null
  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })

  // 헤더 자동 탐지
  let header: unknown[] | null = null
  let dataRows: unknown[][] = []
  for (const wsName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wsName], { header: 1, raw: true, defval: '' })
    const hi = rows.findIndex(row => REQUIRED_COLS.every(col => row.some(cell => norm(cell) === norm(col))))
    if (hi >= 0) { header = rows[hi]; dataRows = rows.slice(hi + 1); break }
  }
  if (!header) {
    return NextResponse.json(
      { error: '인식할 수 없는 파일 형식입니다. 하나카드 사용내역 파일을 업로드해주세요.' },
      { status: 400 },
    )
  }

  const col = {
    cardType:   findCol(header, '카드구분'),
    date:       findCol(header, '이용일'),
    time:       findCol(header, '이용시간'),
    cardNo:     findCol(header, '카드번호'),
    approved:   findCol(header, '승인금액'),
    cancel:     findCol(header, '승인취소금액'),
    merchant:   findCol(header, '가맹점명'),
    category:   findCol(header, '업종명'),
    bizNo:      findCol(header, '가맹점사업자번호', '가맹점 사업자번호'),
    usageType:  findCol(header, '이용구분'),
    settled:    findCol(header, '매입금액'),
    status:     findCol(header, '상태'),
    submall:    findCol(header, '하위몰정보', '하위몰 정보'),
    sourceSheet:findCol(header, '원본시트'),
    user:       findCol(header, '사용자'),
    account:    findCol(header, '계정과목'),
    classify:   findCol(header, '분류'),
  }

  // ── 1) 행 파싱 ────────────────────────────────────
  type ParsedRow = {
    card_number: string
    tx_date: string
    tx_time: string | null
    card_type: string | null
    merchant_name: string | null
    merchant_category: string | null
    merchant_biz_number: string | null
    approved_amount: number
    cancel_amount: number
    settled_amount: number
    statement_status: string | null
    usage_type: string | null
    submall: string | null
    source_sheet: string | null
    user_name: string | null
    account_text: string | null
    classification: string | null
    source_key: string
  }

  const parsed: ParsedRow[] = []
  const seen = new Map<string, number>()
  let skipped = 0
  const cardNumbers = new Set<string>()

  for (const row of dataRows) {
    const cardNo = toStr(row[col.cardNo])
    const date = toDateStr(row[col.date])
    if (!cardNo || !date) { skipped++; continue }

    const time = col.time >= 0 ? toTimeStr(row[col.time]) : null
    const approved = toNumber(row[col.approved])
    const merchant = col.merchant >= 0 ? toStr(row[col.merchant]) : null

    const baseKey = `${cardNo}|${date}|${time ?? ''}|${approved}|${merchant ?? ''}`
    const occ = (seen.get(baseKey) ?? 0) + 1
    seen.set(baseKey, occ)
    const source_key = occ > 1 ? `${baseKey}#${occ}` : baseKey

    cardNumbers.add(cardNo)
    parsed.push({
      card_number: cardNo,
      tx_date: date,
      tx_time: time,
      card_type: col.cardType >= 0 ? toStr(row[col.cardType]) : null,
      merchant_name: merchant,
      merchant_category: col.category >= 0 ? toStr(row[col.category]) : null,
      merchant_biz_number: col.bizNo >= 0 ? toStr(row[col.bizNo]) : null,
      approved_amount: approved,
      cancel_amount: col.cancel >= 0 ? toNumber(row[col.cancel]) : 0,
      settled_amount: col.settled >= 0 ? toNumber(row[col.settled]) : 0,
      statement_status: col.status >= 0 ? toStr(row[col.status]) : null,
      usage_type: col.usageType >= 0 ? toStr(row[col.usageType]) : null,
      submall: col.submall >= 0 ? toStr(row[col.submall]) : null,
      source_sheet: col.sourceSheet >= 0 ? toStr(row[col.sourceSheet]) : null,
      user_name: col.user >= 0 ? toStr(row[col.user]) : null,
      account_text: col.account >= 0 ? toStr(row[col.account]) : null,
      classification: col.classify >= 0 ? toStr(row[col.classify]) : null,
      source_key,
    })
  }

  if (!parsed.length) {
    return NextResponse.json({ error: '가져올 수 있는 데이터가 없습니다.', skipped }, { status: 400 })
  }

  // ── 2) 카드계좌 확보 (카드번호별 자동 생성) ─────────
  const cardRows = Array.from(cardNumbers).map(card_number => ({ card_company: CARD_COMPANY, card_number }))
  const { error: caErr } = await admin
    .from('card_accounts')
    .upsert(cardRows, { onConflict: 'card_company,card_number', ignoreDuplicates: true })
  if (caErr) return NextResponse.json({ error: `카드계좌 등록 실패: ${caErr.message}` }, { status: 500 })

  // 카드사 거래처(매입처) 확보 + 연결 — 카드 미지급금의 상대처로 사용(거래처별 원장 일관성)
  {
    let { data: vend } = await admin.from('vendors').select('id').eq('name', CARD_COMPANY).limit(1).maybeSingle()
    if (!vend) {
      const ins = await admin.from('vendors')
        .insert({ name: CARD_COMPANY, type: 'vendor', note: '법인카드 카드사 (자동 생성)' })
        .select('id').single()
      vend = ins.data
    }
    if (vend?.id) {
      await admin.from('card_accounts')
        .update({ vendor_id: vend.id })
        .eq('card_company', CARD_COMPANY)
        .is('vendor_id', null)
    }
  }

  const accountsResult = await fetchAllRows<{ id: string; card_number: string }>((f, t) =>
    admin.from('card_accounts').select('id, card_number').eq('card_company', CARD_COMPANY).range(f, t),
  )
  if ('error' in accountsResult) return NextResponse.json({ error: `카드계좌 조회 실패: ${accountsResult.error}` }, { status: 500 })
  const cardAccountId = new Map(accountsResult.data.map(a => [a.card_number, a.id]))

  // ── 3) 계정과목 매핑 + 키워드 분류기 준비 ───────────
  const { data: accounts } = await admin
    .from('accounts')
    .select('id, name, keywords')
    .eq('is_active', true)
  const nameToAccountId = new Map<string, string>((accounts ?? []).map(a => [String(a.name).trim(), a.id as string]))
  const accountsWithKw = (accounts ?? [])
    .filter(a => Array.isArray(a.keywords) && (a.keywords as string[]).length > 0)
    .map(a => ({ id: a.id as string, keywords: a.keywords as string[] }))

  // ── 4) 기존 분류값 보존 (재업로드 시 사용자 보정 유지) ──
  const keys = parsed.map(p => p.source_key)
  const preserved = new Map<string, { confirmed_account_id: string | null; classify_status: string; classification: string | null }>()
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK)
    const { data, error } = await admin
      .from('card_expenses')
      .select('source_key, confirmed_account_id, classify_status, classification')
      .in('source_key', chunk)
    if (error) return NextResponse.json({ error: `기존 내역 조회 실패: ${error.message}` }, { status: 500 })
    for (const r of data ?? []) {
      preserved.set(r.source_key as string, {
        confirmed_account_id: r.confirmed_account_id as string | null,
        classify_status: r.classify_status as string,
        classification: r.classification as string | null,
      })
    }
  }

  // ── 5) upsert 행 구성 ───────────────────────────────
  let confirmedCount = 0
  let suggestedCount = 0
  const upsertRows = parsed.map(p => {
    const prev = preserved.get(p.source_key)

    // 계정과목 결정
    let confirmed_account_id: string | null = null
    let suggested_account_id: string | null = null
    let classify_status: 'pending' | 'confirmed' = 'pending'
    let ai_reason: string | null = null
    let ai_confidence: number | null = null

    if (p.account_text && nameToAccountId.has(p.account_text)) {
      // 파일에 계정과목 명시 → 즉시 확정
      confirmed_account_id = nameToAccountId.get(p.account_text)!
      classify_status = 'confirmed'
      confirmedCount++
    } else if (prev?.confirmed_account_id) {
      // 파일엔 없지만 이전에 사용자가 확정해 둔 값 → 보존
      confirmed_account_id = prev.confirmed_account_id
      classify_status = 'confirmed'
    } else {
      // 키워드 분류기로 제안 (승인 대기)
      const text = [p.merchant_name, p.merchant_category].filter(Boolean).join(' ')
      const hit = classifyByKeywords(text, accountsWithKw)
      if (hit) {
        suggested_account_id = hit.id
        ai_reason = `키워드 매칭: "${hit.keyword}"`
        ai_confidence = 0.8
        suggestedCount++
      }
      classify_status = 'pending'
    }

    return {
      card_account_id: cardAccountId.get(p.card_number) ?? null,
      tx_date: p.tx_date,
      tx_time: p.tx_time,
      card_type: p.card_type,
      merchant_name: p.merchant_name,
      merchant_category: p.merchant_category,
      merchant_biz_number: p.merchant_biz_number,
      approved_amount: p.approved_amount,
      cancel_amount: p.cancel_amount,
      settled_amount: p.settled_amount,
      statement_status: p.statement_status,
      usage_type: p.usage_type,
      submall: p.submall,
      source_sheet: p.source_sheet,
      user_name: p.user_name,
      suggested_account_id,
      confirmed_account_id,
      classify_status,
      ai_confidence,
      ai_reason,
      // 분류: 파일 값 우선, 없으면 기존 보존
      classification: p.classification ?? prev?.classification ?? null,
      source_key: p.source_key,
    }
  })

  for (let i = 0; i < upsertRows.length; i += CHUNK) {
    const { error } = await admin
      .from('card_expenses')
      .upsert(upsertRows.slice(i, i + CHUNK), { onConflict: 'source_key' })
    if (error) return NextResponse.json({ error: `사용내역 저장 실패: ${error.message}` }, { status: 500 })
  }

  // ── 확정(파일 계정과목) 건 자동 분개 — "업로드 = 회계 자동 생성" ──
  let posted = 0
  for (let i = 0; i < keys.length; i += CHUNK) {
    const { data: rows } = await admin
      .from('card_expenses')
      .select('id')
      .in('source_key', keys.slice(i, i + CHUNK))
      .eq('classify_status', 'confirmed')
    for (const r of rows ?? []) {
      const jr = await syncCardExpenseJournal(admin, r.id as string)
      if (!('error' in jr)) posted++
    }
  }

  return NextResponse.json({
    imported: upsertRows.length,
    card_accounts: cardNumbers.size,
    confirmed: confirmedCount,
    suggested: suggestedCount,
    posted,
    skipped,
    total_rows: dataRows.length,
  })
}
