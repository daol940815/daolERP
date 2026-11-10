// 통장 내역 통합 검색·필터 모델 (2026-11-10 승인 시안: docs/mockups/통장내역_통합검색_시안.html)
//
// 화면의 "+ 필터" 드롭다운이 만드는 필터와, 검색창에 "금액:168300"처럼 치는 단축 입력이
// 같은 구조(TxFilter)로 들어온다. 문자열 직렬화(serialize)는 주소(?q=)에 남기는 용도이자
// 단축 입력 문법 그 자체다 — parse(serialize(f)) === f 가 되도록 유지한다.
// 적용은 서버가 아니라 불러온 행에 즉시(AG Grid 외부 필터) — 기간·계좌만 서버 조회 조건.

import type { Transaction, Account } from '@/types/transaction'
import type { Vendor } from '@/types/tax-invoice'

export type AmountDir = 'any' | 'in' | 'out'
export type AmountOp  = 'none' | 'eq' | 'range' | 'gte' | 'lte'
export type TxStatus  = 'pending' | 'reviewed' | 'confirmed'
export type TxSource  = 'bank' | 'card'
export type LinkKind  = 'transfer' | 'invoice' | 'none'

export type TxFilter =
  | { kind: 'text';    value: string; negate: boolean }
  | { kind: 'amount';  dir: AmountDir; op: AmountOp; a: number | null; b: number | null }
  // name: 계정과목 이름(부분 일치). 특수값 '없음' = 확정·추천 모두 없음, '추천' = 추천만 있고 미확정
  | { kind: 'account'; name: string }
  // name: 거래처 이름(부분 일치). 특수값 '없음' = 미지정
  | { kind: 'vendor';  name: string }
  | { kind: 'status';  values: TxStatus[] }
  // text: 계좌 별칭·은행명 부분 일치 (서버 조회 조건 bankAccountId와 별개 — 불러온 행 안에서 좁히기)
  | { kind: 'bank';    text: string }
  | { kind: 'source';  values: TxSource[] }
  | { kind: 'memo';    text: string }
  // value: 'YYYY-MM' 또는 'YYYY-MM-DD'
  | { kind: 'date';    value: string }
  | { kind: 'link';    value: LinkKind }

export type TxFilterKind = TxFilter['kind']

export const FILTER_LABEL: Record<TxFilterKind, string> = {
  text: '검색어', amount: '금액', account: '계정과목', vendor: '거래처', status: '상태',
  bank: '계좌', source: '출처', memo: '메모', date: '날짜', link: '연결',
}

export const STATUS_LABEL: Record<TxStatus, string> = { pending: '미검토', reviewed: '검토완료', confirmed: '확정' }
export const SOURCE_LABEL: Record<TxSource, string> = { bank: '은행', card: '카드' }
export const LINK_LABEL:   Record<LinkKind, string> = { transfer: '이체쌍', invoice: '계산서 매칭', none: '미연결' }
export const DIR_LABEL:    Record<AmountDir, string> = { any: '입금·출금 모두', in: '입금만', out: '출금만' }

const STATUS_BY_LABEL: Record<string, TxStatus> = { '미검토': 'pending', '검토완료': 'reviewed', '확정': 'confirmed' }
const SOURCE_BY_LABEL: Record<string, TxSource> = { '은행': 'bank', '카드': 'card' }
const LINK_BY_LABEL:   Record<string, LinkKind> = { '이체쌍': 'transfer', '이체': 'transfer', '계산서': 'invoice', '계산서매칭': 'invoice', '없음': 'none', '미연결': 'none' }

// ── 숫자 ───────────────────────────────────────────────
export const parseNum = (s: string): number | null => {
  const n = Number(s.replace(/[,원\s]/g, ''))
  return Number.isFinite(n) && s.trim() !== '' ? n : null
}
const fmtNum = (n: number | null) => n == null ? '' : n.toLocaleString('ko-KR')

// "168300" / "100000~200000" / ">=1000000" / "<50000" / "" → 금액 조건
export function parseAmountExpr(expr: string): { op: AmountOp; a: number | null; b: number | null } {
  const s = expr.trim()
  if (!s) return { op: 'none', a: null, b: null }
  const range = s.match(/^(.+?)~(.+)$/)
  if (range) return { op: 'range', a: parseNum(range[1]), b: parseNum(range[2]) }
  const cmp = s.match(/^(>=|<=|>|<)(.+)$/)
  if (cmp) return { op: cmp[1].startsWith('>') ? 'gte' : 'lte', a: parseNum(cmp[2]), b: null }
  return { op: 'eq', a: parseNum(s), b: null }
}

// ── 파싱 (단축 입력 → 필터) ─────────────────────────────
// 토큰은 공백으로 나눈다. "지정어:값" 꼴이고 지정어가 목록에 있으면 필터, 아니면 검색어.
// 앞에 '-'를 붙이면 검색어 제외(지정어 필터에는 제외 없음).
export function parseQuery(q: string): TxFilter[] {
  const out: TxFilter[] = []
  for (const raw of q.split(/\s+/).filter(Boolean)) {
    let negate = false
    let tok = raw
    if (tok.startsWith('-') && tok.length > 1 && !/^-\d/.test(tok)) { negate = true; tok = tok.slice(1) }
    const m = tok.match(/^([^:：]+)[:：](.*)$/)
    const key = m?.[1]
    const val = m?.[2] ?? ''
    if (m && key) {
      const f = fieldFilter(key, val)
      if (f) { out.push(f); continue }
    }
    if (tok === '입금' || tok === '출금') { out.push({ kind: 'amount', dir: tok === '입금' ? 'in' : 'out', op: 'none', a: null, b: null }); continue }
    out.push({ kind: 'text', value: tok, negate })
  }
  return mergeFilters(out)
}

function fieldFilter(key: string, val: string): TxFilter | null {
  switch (key) {
    case '금액': case '입금': case '출금': {
      const dir: AmountDir = key === '금액' ? 'any' : key === '입금' ? 'in' : 'out'
      const { op, a, b } = parseAmountExpr(val)
      if (op !== 'none' && a == null) return null
      return { kind: 'amount', dir, op, a, b }
    }
    case '계정': case '계정과목': return val ? { kind: 'account', name: val } : null
    case '거래처': return val ? { kind: 'vendor', name: val } : null
    case '상태': {
      const values = val.split(',').map(v => STATUS_BY_LABEL[v.trim()]).filter((v): v is TxStatus => !!v)
      return values.length ? { kind: 'status', values } : null
    }
    case '계좌': return val ? { kind: 'bank', text: val } : null
    case '출처': {
      const values = val.split(',').map(v => SOURCE_BY_LABEL[v.trim()]).filter((v): v is TxSource => !!v)
      return values.length ? { kind: 'source', values } : null
    }
    case '메모': return val ? { kind: 'memo', text: val } : null
    case '날짜': return /^\d{4}-\d{2}(-\d{2})?$/.test(val) ? { kind: 'date', value: val } : null
    case '연결': { const v = LINK_BY_LABEL[val.replace(/\s/g, '')]; return v ? { kind: 'link', value: v } : null }
    default: return null
  }
}

// 같은 종류가 둘 이상이면 하나만 남긴다(검색어는 여러 개 허용). 뒤에 온 것이 이긴다.
export function mergeFilters(filters: TxFilter[]): TxFilter[] {
  const texts = filters.filter(f => f.kind === 'text')
  const rest = new Map<TxFilterKind, TxFilter>()
  for (const f of filters) if (f.kind !== 'text') rest.set(f.kind, f)
  return [...texts, ...Array.from(rest.values())]
}

// ── 직렬화 (필터 → 단축 입력 문자열) ───────────────────
export function serializeFilter(f: TxFilter): string {
  switch (f.kind) {
    case 'text': return (f.negate ? '-' : '') + f.value
    case 'amount': {
      const key = f.dir === 'any' ? '금액' : f.dir === 'in' ? '입금' : '출금'
      if (f.op === 'none') return f.dir === 'any' ? '' : key
      const n = (x: number | null) => String(x ?? '')
      const expr = f.op === 'eq' ? n(f.a) : f.op === 'range' ? `${n(f.a)}~${n(f.b)}` : f.op === 'gte' ? `>=${n(f.a)}` : `<=${n(f.a)}`
      return `${key}:${expr}`
    }
    case 'account': return `계정:${f.name}`
    case 'vendor':  return `거래처:${f.name}`
    case 'status':  return `상태:${f.values.map(v => STATUS_LABEL[v]).join(',')}`
    case 'bank':    return `계좌:${f.text}`
    case 'source':  return `출처:${f.values.map(v => SOURCE_LABEL[v]).join(',')}`
    case 'memo':    return `메모:${f.text}`
    case 'date':    return `날짜:${f.value}`
    // 직렬화 값에는 공백이 들어가면 안 된다(토큰이 공백으로 갈라진다)
    case 'link':    return `연결:${f.value === 'transfer' ? '이체쌍' : f.value === 'invoice' ? '계산서' : '미연결'}`
  }
}
export const serializeQuery = (filters: TxFilter[]) => filters.map(serializeFilter).filter(Boolean).join(' ')

// 칩에 보이는 사람용 설명
export function describeFilter(f: TxFilter): { label: string; value: string } {
  switch (f.kind) {
    case 'text':   return { label: f.negate ? '제외' : bareNumber(f.value) != null ? '검색어·금액' : '검색어', value: f.value }
    case 'amount': {
      const dir = DIR_LABEL[f.dir]
      if (f.op === 'none') return { label: '금액', value: dir }
      const v = f.op === 'eq' ? fmtNum(f.a) : f.op === 'range' ? `${fmtNum(f.a)} ~ ${fmtNum(f.b)}` : f.op === 'gte' ? `${fmtNum(f.a)} 이상` : `${fmtNum(f.a)} 이하`
      return { label: '금액', value: f.dir === 'any' ? v : `${v} (${dir})` }
    }
    case 'account': return { label: '계정과목', value: f.name === '없음' ? '미분류' : f.name === '추천' ? '추천만 있음' : f.name }
    case 'vendor':  return { label: '거래처', value: f.name === '없음' ? '미지정' : f.name }
    case 'status':  return { label: '상태', value: f.values.map(v => STATUS_LABEL[v]).join('·') }
    case 'bank':    return { label: '계좌', value: f.text }
    case 'source':  return { label: '출처', value: f.values.map(v => SOURCE_LABEL[v]).join('·') }
    case 'memo':    return { label: '메모', value: f.text }
    case 'date':    return { label: '날짜', value: f.value }
    case 'link':    return { label: '연결', value: LINK_LABEL[f.value] }
  }
}

// ── 적용 ───────────────────────────────────────────────
export interface TxFilterContext {
  accountMap: Record<string, Account>
  vendorMap: Record<string, Vendor>
}

// "168300" / "168,300" / "168300원" → 숫자, 그 외(날짜·계좌번호 조각 등 하이픈 포함) → null
export const bareNumber = (s: string): number | null => /^[\d,]+원?$/.test(s.trim()) ? parseNum(s) : null

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase()
const has  = (hay: string | null | undefined, needle: string) => norm(hay).includes(needle.toLowerCase())

function accountNameOf(tx: Transaction, ctx: TxFilterContext): string | null {
  const id = tx.confirmed_account_id ?? tx.suggested_account_id
  return id ? (ctx.accountMap[id]?.name ?? null) : null
}

function amountPass(v: number, f: Extract<TxFilter, { kind: 'amount' }>): boolean {
  switch (f.op) {
    case 'none':  return true
    case 'eq':    return v === f.a
    case 'range': return (f.a == null || v >= f.a) && (f.b == null || v <= f.b)
    case 'gte':   return f.a != null && v >= f.a
    case 'lte':   return f.a != null && v <= f.a
  }
}

export function matchFilter(tx: Transaction, f: TxFilter, ctx: TxFilterContext): boolean {
  switch (f.kind) {
    case 'text': {
      // 검색창에 "168300"·"168,300"처럼 숫자만 치면 글자 검색에 더해 입금액·출금액이 같은 행도 찾는다
      // (금액: 접두 없이 금액을 치고 '결과 없음'을 보던 문제 — 2026-11-10 사용자 보고)
      const n = bareNumber(f.value)
      const hit = has(tx.description, f.value) || has(tx.counterparty_name, f.value) || has(tx.memo, f.value)
        || has(tx.account_alias, f.value) || has(accountNameOf(tx, ctx), f.value)
        || (tx.vendor_id ? has(ctx.vendorMap[tx.vendor_id]?.name, f.value) : false)
        || (n != null && ((tx.amount_in ?? 0) === n || (tx.amount_out ?? 0) === n))
      return f.negate ? !hit : hit
    }
    case 'amount': {
      const inn = tx.amount_in ?? 0, out = tx.amount_out ?? 0
      if (f.dir === 'in')  return inn > 0 && amountPass(inn, f)
      if (f.dir === 'out') return out > 0 && amountPass(out, f)
      return (inn > 0 && amountPass(inn, f)) || (out > 0 && amountPass(out, f))
    }
    case 'account': {
      if (f.name === '없음') return !tx.confirmed_account_id && !tx.suggested_account_id && !tx.transfer_pair_id
      if (f.name === '추천') return !tx.confirmed_account_id && !!tx.suggested_account_id
      const name = accountNameOf(tx, ctx)
      return !!name && (name === f.name || has(name, f.name))
    }
    case 'vendor': {
      if (f.name === '없음') return !tx.vendor_id
      const name = tx.vendor_id ? ctx.vendorMap[tx.vendor_id]?.name : null
      return !!name && (name === f.name || has(name, f.name))
    }
    case 'status': return f.values.includes(tx.status)
    case 'bank':   return has(tx.account_alias, f.text)
    case 'source': return f.values.includes(tx.source as TxSource)
    case 'memo':   return has(tx.memo, f.text)
    case 'date':   return String(tx.tx_date ?? '').startsWith(f.value)
    case 'link':
      if (f.value === 'transfer') return !!tx.transfer_pair_id
      if (f.value === 'invoice')  return (tx.invoice_links?.length ?? 0) > 0
      return !tx.transfer_pair_id && !(tx.invoice_links?.length)
  }
}

export const matchAll = (tx: Transaction, filters: TxFilter[], ctx: TxFilterContext) =>
  filters.every(f => matchFilter(tx, f, ctx))

// 적요 강조용 — 제외가 아닌 검색어 목록
export const highlightTerms = (filters: TxFilter[]) =>
  filters.filter((f): f is Extract<TxFilter, { kind: 'text' }> => f.kind === 'text' && !f.negate).map(f => f.value)

// ── 빠른 조건 칩 ────────────────────────────────────────
export const QUICK_FILTERS: { label: string; filter: TxFilter }[] = [
  { label: '입금만',      filter: { kind: 'amount', dir: 'in',  op: 'none', a: null, b: null } },
  { label: '출금만',      filter: { kind: 'amount', dir: 'out', op: 'none', a: null, b: null } },
  { label: '미검토',      filter: { kind: 'status', values: ['pending'] } },
  { label: '추천만 있음', filter: { kind: 'account', name: '추천' } },
  { label: '미분류',      filter: { kind: 'account', name: '없음' } },
  { label: '이체쌍',      filter: { kind: 'link', value: 'transfer' } },
  { label: '계산서 매칭', filter: { kind: 'link', value: 'invoice' } },
  { label: '카드',        filter: { kind: 'source', values: ['card'] } },
]

export const sameFilter = (a: TxFilter, b: TxFilter) => serializeFilter(a) === serializeFilter(b)
