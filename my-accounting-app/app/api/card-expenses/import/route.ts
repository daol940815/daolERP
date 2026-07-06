import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { syncCardExpenseJournal } from '@/lib/journal/card-posting'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// POST /api/card-expenses/import
// 법인카드 사용내역 업로드 (멀티 카드사·멀티 시트·멀티 양식 지원).
// - 양식 프로파일: ① 표준(하나 등: 이용일·승인금액) ② 롯데(승인일자·승인금액(원화)·취소여부)
//   ③ 우리(이용일자 MM.DD·접수/취소 — 연도는 상단 기간행에서 추출)
// - 카드사 판정: 프로파일 고정(롯데/우리) → '카드구분' 컬럼 → 시트명 →
//   기존 card_accounts 번호 앞자리(BIN) 추론 → 실패 시 '기타카드'(검토)
// - 부가세 컬럼(하나·롯데)이 있으면 tax_amount로 저장 → 분개에서 부가세대급금 분리
// - source_key(카드사|카드번호|이용일|이용시간|승인금액|가맹점명 + 동일키 순번)로 멱등 upsert.
//   재업로드 시 사용자가 보정한 계정과목/분류는 보존한다.

// 양식 프로파일 식별용 컬럼 (norm() 후 비교)
const STD_COLS   = ['카드번호', '이용일', '승인금액', '가맹점명']            // 표준(하나 등)
const LOTTE_COLS = ['카드번호', '승인일자', '승인금액(원화)', '가맹점명']     // 롯데 카드승인내역(그룹별)
const WOORI_COLS = ['이용일자', '승인번호', '이용카드', '이용가맹점명']       // 우리 승인상세내역
const CHUNK = 500

// 카드구분/시트명 → 표준 카드사명 (그룹핑·거래처 일관성용)
function canonicalCardCompany(cardType: string | null, sheetName: string): string {
  const s = `${cardType ?? ''} ${sheetName}`.toLowerCase()
  if (s.includes('하나')) return '하나카드'
  if (s.includes('bc') || s.includes('비씨')) return 'BC카드'
  if (s.includes('롯데')) return '롯데카드'
  if (s.includes('신한')) return '신한카드'
  if (s.includes('삼성')) return '삼성카드'
  if (s.includes('현대')) return '현대카드'
  if (s.includes('국민') || s.includes('kb')) return '국민카드'
  if (s.includes('농협') || s.includes('nh')) return '농협카드'
  if (s.includes('우리')) return '우리카드'
  return (cardType || sheetName || '기타카드').trim()
}
// 카드번호 정규화: 숫자만 추출 (대시/공백/마스킹 표기 차이 통일)
function normCardNo(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '')
}

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
// 이용일: '2026.03.31' / Date / 엑셀시리얼 / 'YYYY-MM-DD' / '04.14 10:45'(연도없음) 처리.
// defaultYear: 연도가 없는 'MM.DD' 형식일 때 보충할 연도(시트에서 추론).
function toDateStr(v: unknown, defaultYear?: number): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' && v > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const s = String(v ?? '').trim()
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  // 연도 없는 'MM.DD'(예: '04.14 10:45') — 시트에서 추론한 연도로 보충
  if (defaultYear) {
    const m2 = s.match(/^(\d{1,2})[.\-/](\d{1,2})(?:\s|$)/)
    if (m2) return `${defaultYear}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`
  }
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

  // ── 1) 행 파싱 (모든 시트 순회 — 시트별 카드사 합본 지원) ──
  type ParsedRow = {
    card_company: string
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
    tax_amount: number
    source_key: string
  }

  const parsed: ParsedRow[] = []
  const seen = new Map<string, number>()
  let skipped = 0
  const cardKeys = new Set<string>()   // `${card_company}|${card_number}`
  let matchedAnySheet = false

  // 카드사 판정 폴백용: 기존 카드계좌의 번호 앞자리(BIN) → 카드사
  const { data: knownCards } = await admin
    .from('card_accounts').select('card_company, card_number')
  const binOf = (no: string) => normCardNo(no).slice(0, 4)
  const companyByBin = new Map<string, string>()
  for (const c of knownCards ?? []) {
    const bin = binOf(c.card_number as string)
    if (bin.length === 4) companyByBin.set(bin, c.card_company as string)
  }
  const inferCompany = (cardType: string | null, sheetName: string, cardNo: string): string => {
    const byName = canonicalCardCompany(cardType, sheetName)
    // canonicalCardCompany는 미인식 시 시트명을 그대로 반환 → 표준 카드사명이 아니면 BIN 추론
    const KNOWN = ['하나카드','BC카드','롯데카드','신한카드','삼성카드','현대카드','국민카드','농협카드','우리카드']
    if (KNOWN.includes(byName)) return byName
    return companyByBin.get(binOf(cardNo)) ?? '기타카드'
  }

  const push = (p: Omit<ParsedRow, 'source_key'>) => {
    const baseKey = `${p.card_company}|${p.card_number}|${p.tx_date}|${p.tx_time ?? ''}|${p.approved_amount}|${p.merchant_name ?? ''}`
    const occ = (seen.get(baseKey) ?? 0) + 1
    seen.set(baseKey, occ)
    cardKeys.add(`${p.card_company}|${p.card_number}`)
    parsed.push({ ...p, source_key: occ > 1 ? `${baseKey}#${occ}` : baseKey })
  }
  const has = (header: unknown[], cols: string[]) =>
    cols.every(c => header.some(cell => norm(cell) === norm(c)))

  for (const wsName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wsName], { header: 1, raw: true, defval: '' })
    const hi = rows.findIndex(row => has(row, STD_COLS) || has(row, LOTTE_COLS) || has(row, WOORI_COLS))
    if (hi < 0) continue   // 인식 가능한 헤더 없는 시트(안내/요약 등)는 건너뜀
    matchedAnySheet = true
    const header = rows[hi]
    const dataRows = rows.slice(hi + 1)

    // ── 프로파일 ②: 롯데 (승인일자·승인금액(원화)·취소여부, 부가세 포함) ──
    if (!has(header, STD_COLS) && has(header, LOTTE_COLS)) {
      const col = {
        cardNo:   findCol(header, '카드번호'),
        user:     findCol(header, '회원명'),
        date:     findCol(header, '승인일자'),
        time:     findCol(header, '승인시간'),
        merchant: findCol(header, '가맹점명'),
        amount:   findCol(header, '승인금액(원화)'),
        canceled: findCol(header, '취소여부'),
        vat:      findCol(header, '부가세'),
        bizNo:    findCol(header, '사업자번호'),
        category: findCol(header, '가맹점업종'),
        memo:     findCol(header, '메모(적요)'),
        account:  findCol(header, '계정과목'),   // 사용자 추가 컬럼 지원 (있으면 즉시 확정)
      }
      for (const row of dataRows) {
        const cardNo = normCardNo(row[col.cardNo])
        const date = toDateStr(row[col.date])
        if (!cardNo || !date) { skipped++; continue }
        const amount = toNumber(row[col.amount])
        const isCanceled = String(row[col.canceled] ?? '').trim().toUpperCase() === 'Y'
        push({
          card_company: '롯데카드', card_number: cardNo,
          tx_date: date, tx_time: col.time >= 0 ? toTimeStr(row[col.time]) : null,
          card_type: null,
          merchant_name: toStr(row[col.merchant]),
          merchant_category: col.category >= 0 ? toStr(row[col.category]) : null,
          merchant_biz_number: col.bizNo >= 0 ? toStr(row[col.bizNo]) : null,
          approved_amount: isCanceled ? 0 : amount,
          cancel_amount: isCanceled ? amount : 0,
          settled_amount: 0,
          statement_status: isCanceled ? '취소' : null,
          usage_type: null, submall: null, source_sheet: wsName,
          user_name: col.user >= 0 ? toStr(row[col.user]) : null,
          account_text: col.account >= 0 ? toStr(row[col.account]) : null,
          classification: col.memo >= 0 ? toStr(row[col.memo]) : null,
          tax_amount: isCanceled ? 0 : (col.vat >= 0 ? toNumber(row[col.vat]) : 0),
        })
      }
      continue
    }

    // ── 프로파일 ③: 우리 (이용일자 'MM.DD HH:MM', 연도는 상단 기간행) ──
    if (!has(header, STD_COLS) && has(header, WOORI_COLS)) {
      // 헤더 위 행들에서 'YYYY.MM.DD ~' 기간을 찾아 연도 결정
      let periodYear: number | undefined
      for (let r = 0; r < hi; r++) {
        for (const cell of rows[r]) {
          const m = String(cell ?? '').match(/(\d{4})\.\d{2}\.\d{2}\s*~/)
          if (m) { periodYear = Number(m[1]); break }
        }
        if (periodYear) break
      }
      const col = {
        date:     findCol(header, '이용일자'),
        cardNo:   findCol(header, '이용카드'),
        merchant: findCol(header, '이용가맹점명'),
        amount:   findCol(header, '승인금액/취소(원)', '승인금액 /취소(원)', '승인금액/취소'),
        status:   findCol(header, '접수/취소'),
        account:  findCol(header, '계정과목'),   // 사용자 추가 컬럼 지원
      }
      // 금액 컬럼: 개행 포함 표기 대응 — norm 비교로 재탐색
      if (col.amount < 0) col.amount = header.findIndex(h => norm(h).startsWith('승인금액'))
      for (const row of dataRows) {
        const rawDate = String(row[col.date] ?? '').trim()   // '04.27 12:26'
        const m = rawDate.match(/^(\d{1,2})[.](\d{1,2})(?:\s+(\d{1,2}:\d{2}))?/)
        const cardNo = normCardNo(row[col.cardNo])
        if (!m || !cardNo || !periodYear) { if (rawDate || cardNo) skipped++; continue }
        const date = `${periodYear}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
        const amount = toNumber(row[col.amount])
        const isCanceled = String(row[col.status] ?? '').includes('취소')
        push({
          card_company: '우리카드', card_number: cardNo,
          tx_date: date, tx_time: m[3] ? m[3].padStart(5, '0') : null,
          card_type: null,
          merchant_name: toStr(row[col.merchant]),
          merchant_category: null, merchant_biz_number: null,
          approved_amount: isCanceled ? 0 : amount,
          cancel_amount: isCanceled ? amount : 0,
          settled_amount: 0,
          statement_status: isCanceled ? '취소' : null,
          usage_type: null, submall: null, source_sheet: wsName,
          user_name: null,
          account_text: col.account >= 0 ? toStr(row[col.account]) : null,
          classification: null,
          tax_amount: 0,   // 우리카드 파일엔 부가세 정보 없음
        })
      }
      continue
    }

    // ── 프로파일 ①: 표준 (하나 및 기존 합본 양식, 부가세 컬럼 지원 추가) ──
    const col0 = findCol(header, '이용일')
    // 시트의 기준 연도 추론(연도 있는 날짜 중 최빈) — 'MM.DD' 형식 보충용
    const yearCount = new Map<number, number>()
    for (const r of dataRows) {
      const d = toDateStr(r[col0])
      if (d) { const y = Number(d.slice(0, 4)); yearCount.set(y, (yearCount.get(y) ?? 0) + 1) }
    }
    const sheetYear = Array.from(yearCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
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
      vat:        findCol(header, '부가세'),
    }

    for (const row of dataRows) {
      const cardNo = normCardNo(row[col.cardNo])
      const date = toDateStr(row[col.date], sheetYear)
      if (!cardNo || !date) { skipped++; continue }

      const company = inferCompany(col.cardType >= 0 ? toStr(row[col.cardType]) : null, wsName, cardNo)
      push({
        card_company: company,
        card_number: cardNo,
        tx_date: date,
        tx_time: col.time >= 0 ? toTimeStr(row[col.time]) : null,
        card_type: col.cardType >= 0 ? toStr(row[col.cardType]) : null,
        merchant_name: col.merchant >= 0 ? toStr(row[col.merchant]) : null,
        merchant_category: col.category >= 0 ? toStr(row[col.category]) : null,
        merchant_biz_number: col.bizNo >= 0 ? toStr(row[col.bizNo]) : null,
        approved_amount: toNumber(row[col.approved]),
        cancel_amount: col.cancel >= 0 ? toNumber(row[col.cancel]) : 0,
        settled_amount: col.settled >= 0 ? toNumber(row[col.settled]) : 0,
        statement_status: col.status >= 0 ? toStr(row[col.status]) : null,
        usage_type: col.usageType >= 0 ? toStr(row[col.usageType]) : null,
        submall: col.submall >= 0 ? toStr(row[col.submall]) : null,
        source_sheet: col.sourceSheet >= 0 ? toStr(row[col.sourceSheet]) : wsName,
        user_name: col.user >= 0 ? toStr(row[col.user]) : null,
        account_text: col.account >= 0 ? toStr(row[col.account]) : null,
        classification: col.classify >= 0 ? toStr(row[col.classify]) : null,
        tax_amount: col.vat >= 0 ? toNumber(row[col.vat]) : 0,
      })
    }
  }

  if (!matchedAnySheet) {
    return NextResponse.json(
      { error: '인식할 수 없는 파일 형식입니다. (필수 컬럼: 카드번호·이용일·승인금액·가맹점명)' },
      { status: 400 },
    )
  }
  if (!parsed.length) {
    return NextResponse.json({ error: '가져올 수 있는 데이터가 없습니다.', skipped }, { status: 400 })
  }

  // ── 2) 카드계좌 확보 (카드사·카드번호별 자동 생성) ─────────
  const cardRows = Array.from(cardKeys).map(key => {
    const [card_company, card_number] = key.split('|')
    return { card_company, card_number }
  })
  const { error: caErr } = await admin
    .from('card_accounts')
    .upsert(cardRows, { onConflict: 'card_company,card_number', ignoreDuplicates: true })
  if (caErr) return NextResponse.json({ error: `카드계좌 등록 실패: ${caErr.message}` }, { status: 500 })

  // 카드사 거래처(매입처) 확보 + 연결 — 카드 미지급금의 상대처로 사용(거래처별 원장 일관성)
  const companies = Array.from(new Set(cardRows.map(c => c.card_company)))
  for (const company of companies) {
    let { data: vend } = await admin.from('vendors').select('id').eq('name', company).limit(1).maybeSingle()
    if (!vend) {
      const ins = await admin.from('vendors')
        .insert({ name: company, type: 'vendor', note: '법인카드 카드사 (자동 생성)' })
        .select('id').single()
      vend = ins.data
    }
    if (vend?.id) {
      await admin.from('card_accounts')
        .update({ vendor_id: vend.id })
        .eq('card_company', company)
        .is('vendor_id', null)
    }
  }

  // 카드계좌 id 매핑 (카드사|카드번호 → id)
  const accountsResult = await fetchAllRows<{ id: string; card_company: string; card_number: string }>((f, t) =>
    admin.from('card_accounts').select('id, card_company, card_number').in('card_company', companies).range(f, t),
  )
  if ('error' in accountsResult) return NextResponse.json({ error: `카드계좌 조회 실패: ${accountsResult.error}` }, { status: 500 })
  const cardAccountId = new Map(accountsResult.data.map(a => [`${a.card_company}|${a.card_number}`, a.id]))

  // ── 3) 계정과목 매핑 + 키워드 분류기 준비 ───────────
  const { data: accounts } = await admin
    .from('accounts')
    .select('id, name, keywords')
    .eq('is_active', true)
  const nameToAccountId = new Map<string, string>((accounts ?? []).map(a => [String(a.name).trim(), a.id as string]))
  const accountsWithKw = (accounts ?? [])
    .filter(a => Array.isArray(a.keywords) && (a.keywords as string[]).length > 0)
    .map(a => ({ id: a.id as string, keywords: a.keywords as string[] }))

  // ── 3-1) 가맹점 학습 (거래처 마스터 정책 §7 — 확정 이력이 곧 추천 데이터) ──
  // 과거에 사용자가 확정한 카드 건들을 가맹점(사업자번호 우선, 이름 차선)별로 집계해,
  // 같은 가맹점의 새 거래에 "이전 확정 계정"을 추천한다(과반 계정만, 추천 전용 — 확정은 사용자).
  const learnedByBiz = new Map<string, Map<string, number>>()
  const learnedByName = new Map<string, Map<string, number>>()
  {
    const hist = await fetchAllRows<{ merchant_biz_number: string | null; merchant_name: string | null; confirmed_account_id: string }>((f, t) =>
      admin.from('card_expenses')
        .select('merchant_biz_number, merchant_name, confirmed_account_id')
        .eq('classify_status', 'confirmed')
        .not('confirmed_account_id', 'is', null)
        .range(f, t))
    if (!('error' in hist)) {
      const bump = (m: Map<string, Map<string, number>>, key: string, acc: string) => {
        const c = m.get(key) ?? new Map<string, number>()
        c.set(acc, (c.get(acc) ?? 0) + 1)
        m.set(key, c)
      }
      for (const h of hist.data) {
        const biz = (h.merchant_biz_number ?? '').replace(/\D/g, '')
        if (biz.length >= 10) bump(learnedByBiz, biz, h.confirmed_account_id)
        const nm = (h.merchant_name ?? '').trim()
        if (nm.length >= 2) bump(learnedByName, nm, h.confirmed_account_id)
      }
    }
  }
  // 과반(50% 초과) 계정만 학습 추천으로 인정 — 확정 이력이 갈리는 가맹점은 추천하지 않음
  const learnedAccount = (bizNo: string | null, name: string | null): { id: string; hits: number } | null => {
    const tryMap = (m: Map<string, Map<string, number>>, key: string) => {
      const c = m.get(key)
      if (!c) return null
      const total = Array.from(c.values()).reduce((a, b) => a + b, 0)
      const [accId, hits] = Array.from(c.entries()).sort((a, b) => b[1] - a[1])[0]
      return hits * 2 > total ? { id: accId, hits } : null
    }
    const biz = (bizNo ?? '').replace(/\D/g, '')
    if (biz.length >= 10) {
      const r = tryMap(learnedByBiz, biz)
      if (r) return r
    }
    const nm = (name ?? '').trim()
    if (nm.length >= 2) return tryMap(learnedByName, nm)
    return null
  }

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
      // ① 가맹점 학습 추천 (이전 확정 이력) → ② 키워드 제안 — 모두 승인 대기
      const learned = learnedAccount(p.merchant_biz_number, p.merchant_name)
      if (learned) {
        suggested_account_id = learned.id
        ai_reason = `가맹점 학습: 이전 확정 ${learned.hits}건`
        ai_confidence = 0.85
        suggestedCount++
      } else {
        const text = [p.merchant_name, p.merchant_category].filter(Boolean).join(' ')
        const hit = classifyByKeywords(text, accountsWithKw)
        if (hit) {
          suggested_account_id = hit.id
          ai_reason = `키워드 매칭: "${hit.keyword}"`
          ai_confidence = 0.8
          suggestedCount++
        }
      }
      classify_status = 'pending'
    }

    return {
      card_account_id: cardAccountId.get(`${p.card_company}|${p.card_number}`) ?? null,
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
      tax_amount: p.tax_amount,
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

  const distinctKeys = new Set(keys)
  const updated = Array.from(distinctKeys).filter(k => preserved.has(k)).length
  const created = distinctKeys.size - updated

  return NextResponse.json({
    imported: upsertRows.length,
    created,
    updated,
    card_companies: companies.length,
    card_accounts: cardKeys.size,
    confirmed: confirmedCount,
    suggested: suggestedCount,
    posted,
    skipped,
    total_rows: parsed.length + skipped,
  })
}
