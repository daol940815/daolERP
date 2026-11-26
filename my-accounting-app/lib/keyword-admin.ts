import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetch-all-rows'
import { bankKeywordsColumnExists, normKeyword } from './vendor-keywords.server'

// ── 키워드 관리 (2026-11-26 사용자 결정 — 시안 docs/mockups/통장키워드_관리_시안.html) ──
// 화면 /keywords?tab=bank|invoice (점검 · 정리 도구). 두 탭은 같은 모양.
//   bank    = vendors.bank_keywords (통장 입금 입금자 · 적요로 거래처 알아보기 — 통장 분류 · 결제 확인 · 입금대장)
//   invoice = vendors.match_aliases (계산서 상대 상호로 거래처 알아보기 + 옛 이름 · 별칭 검색)
// 걸린 수 = 최근 6개월 원본(통장 입금 / 매출 · 매입 계산서)의 입금자 · 적요 / 상대 상호에 키워드가 들어 있는 건수.
// 겹침 = 같은 키워드가 다른 거래처(병합된 거래처 제외)에도 있음. 의심 = 숫자만 · 2글자 이하 · 흔한 말.
// 누가 · 언제 넣었는지는 저장돼 있지 않다(키워드는 거래처 칸의 목록) — 2026-11-26 사용자: 기록 없이 진행.

export type KeywordTab = 'bank' | 'invoice'
export const KEYWORD_COL: Record<KeywordTab, 'bank_keywords' | 'match_aliases'> = { bank: 'bank_keywords', invoice: 'match_aliases' }
export const HIT_MONTHS = 6

const COMMON = new Set(['이체', '입금', '송금', '대체', '타행', '타행이체', '계좌이체', '인터넷', '모바일', '인터넷뱅킹', '모바일뱅킹', 'cms', '펌뱅킹', '창구', '현금', '주식회사', '(주)', '㈜', '은행', '지점', '본점'])
export function suspicious(kw: string): string | null {
  const n = normKeyword(kw)
  if (/^\d+$/.test(n)) return '숫자만이라 다른 입금 · 계산서까지 걸릴 수 있음'
  if (n.length <= 2) return '2글자 이하라 다른 입금 · 계산서까지 걸릴 수 있음'
  if (COMMON.has(n)) return '흔한 말이라 다른 입금 · 계산서까지 걸릴 수 있음'
  return null
}

export interface KeywordVendor {
  id: string; name: string; type: string | null
  keywords: { text: string; hits: number; dup_with: string[]; suspicious: string | null }[]
}

const sinceDate = () => { const d = new Date(); d.setMonth(d.getMonth() - HIT_MONTHS); return d.toISOString().slice(0, 10) }

export async function loadKeywordAdmin(admin: SupabaseClient, tab: KeywordTab): Promise<{ error: string } | { vendors: KeywordVendor[]; since: string }> {
  if (tab === 'bank' && !(await bankKeywordsColumnExists(admin))) return { error: '통장 키워드 칸이 아직 없습니다 — 마이그레이션 423을 먼저 실행하세요.' }
  const col = KEYWORD_COL[tab]
  type V = { id: string; name: string; type: string | null; status: string | null } & Record<string, unknown>
  const vRes = await fetchAllRows<V>((f, t) => admin.from('vendors').select(`id, name, type, status, ${col}`).not(col, 'is', null).range(f, t))
  if ('error' in vRes) return { error: vRes.error }
  const vendors = vRes.data.filter(v => v.status !== 'merged' && Array.isArray(v[col]) && (v[col] as string[]).some(Boolean))

  // 겹침: 같은 키워드(공백 · 대소문자 무시)를 가진 거래처들
  const owners = new Map<string, { id: string; name: string }[]>()
  for (const v of vendors) for (const k of (v[col] as string[]).filter(Boolean)) {
    const n = normKeyword(k); const l = owners.get(n) ?? []; if (!l.some(x => x.id === v.id)) l.push({ id: v.id, name: v.name }); owners.set(n, l)
  }

  // 걸린 수 — 최근 6개월 원본 텍스트
  const since = sinceDate()
  const texts: string[] = []
  if (tab === 'bank') {
    const r = await fetchAllRows<{ counterparty_name: string | null; description: string | null }>((f, t) =>
      admin.from('transactions').select('counterparty_name, description').gt('amount_in', 0).gte('tx_date', since).range(f, t))
    if ('error' in r) return { error: r.error }
    for (const x of r.data) texts.push(normKeyword(`${x.counterparty_name ?? ''} ${x.description ?? ''}`))
  } else {
    const r = await fetchAllRows<{ counterparty_name: string | null }>((f, t) =>
      admin.from('tax_invoices').select('counterparty_name').gte('issue_date', since).range(f, t))
    if ('error' in r) return { error: r.error }
    for (const x of r.data) texts.push(normKeyword(x.counterparty_name))
  }
  const hitCache = new Map<string, number>()
  const hitsOf = (n: string) => {
    if (hitCache.has(n)) return hitCache.get(n)!
    let c = 0; if (n) for (const t of texts) if (t.includes(n)) c++
    hitCache.set(n, c); return c
  }

  const out: KeywordVendor[] = vendors.map(v => ({
    id: v.id, name: v.name, type: v.type,
    keywords: Array.from(new Set((v[col] as string[]).filter(Boolean))).map(text => {
      const n = normKeyword(text)
      return { text, hits: hitsOf(n), dup_with: (owners.get(n) ?? []).filter(o => o.id !== v.id).map(o => o.name), suspicious: suspicious(text) }
    }),
  })).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  return { vendors: out, since }
}

// 추가 · 삭제 — 거래처 한 곳의 목록을 고친다. 겹침은 저장하고 경고만 돌려준다(거래처 수정 화면과 같은 규칙)
export async function editKeyword(admin: SupabaseClient, tab: KeywordTab, vendorId: string, op: { add?: string; remove?: string }):
  Promise<{ error: string } | { ok: true; keywords: string[]; warning: string | null }> {
  if (tab === 'bank' && !(await bankKeywordsColumnExists(admin))) return { error: '통장 키워드 칸이 아직 없습니다 — 마이그레이션 423을 먼저 실행하세요.' }
  const col = KEYWORD_COL[tab]
  const { data: v, error } = await (admin.from('vendors').select(`id, name, ${col}`).eq('id', vendorId).maybeSingle() as unknown as
    PromiseLike<{ data: ({ id: string; name: string } & Record<string, unknown>) | null; error: { message: string } | null }>)
  if (error) return { error: error.message }
  if (!v) return { error: '거래처를 찾을 수 없습니다.' }
  const cur = ((v[col] as string[] | null) ?? []).filter(Boolean)
  let next = cur
  let warning: string | null = null
  if (op.add != null) {
    const kw = op.add.trim().slice(0, 60)
    if (normKeyword(kw).length < 2) return { error: '키워드는 2글자 이상이어야 합니다.' }
    if (cur.some(k => normKeyword(k) === normKeyword(kw))) return { error: `"${kw}"는 이미 있습니다.` }
    next = [...cur, kw]
    const dup = await admin.from('vendors').select('id, name').contains(col, [kw]).neq('id', vendorId).neq('status', 'merged').limit(3)
    if (!dup.error && dup.data?.length) warning = `"${kw}" — ${dup.data.map(d => d.name).join(', ')}에도 있음${tab === 'bank' ? ' (자동 연결은 둘 다 건너뜀)' : ''}`
    const s = suspicious(kw); if (s && !warning) warning = `"${kw}" — ${s}`
  } else if (op.remove != null) {
    next = cur.filter(k => k !== op.remove)
    if (next.length === cur.length) return { error: '이미 지워졌습니다. 화면을 새로 고쳐 주세요.' }
  } else return { error: '추가 또는 삭제할 키워드가 없습니다.' }
  const { error: ue } = await admin.from('vendors').update({ [col]: next }).eq('id', vendorId)
  if (ue) return { error: ue.message }
  return { ok: true, keywords: next, warning }
}
