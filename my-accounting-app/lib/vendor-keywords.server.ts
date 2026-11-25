// 거래처 키워드 두 칸 (423, 2026-11-11 승인)
//   match_aliases = 계산서 매칭 키워드 (014) / bank_keywords = 통장 키워드 (423)
// 423 실행 전에는 bank_keywords 컬럼이 없다 — 서버 코드는 컬럼 유무를 한 번 확인해(프로세스 캐시)
// 없으면 match_aliases로 대신 동작한다(옛 방식 그대로). 실행 뒤에는 통장 경로가 bank_keywords만 본다.
import type { SupabaseClient } from '@supabase/supabase-js'

let probe: Promise<boolean> | null = null

export function bankKeywordsColumnExists(admin: SupabaseClient): Promise<boolean> {
  if (!probe) {
    probe = (async () => {
      try {
        const r = await admin.from('vendors').select('bank_keywords').limit(1)
        return !r.error
      } catch {
        return false
      }
    })()
    // 없음으로 판정되면 1분 뒤 다시 확인한다 — 423 실행 직후 재배포 없이 반영되도록
    probe.then(ok => { if (!ok) setTimeout(() => { probe = null }, 60_000) })
  }
  return probe
}

// 통장 매칭에 쓸 키워드 목록 — 컬럼이 있으면 bank_keywords, 없으면 match_aliases
export const bankKeywordsOf = (v: { bank_keywords?: string[] | null; match_aliases?: string[] | null }, hasColumn: boolean): string[] =>
  ((hasColumn ? v.bank_keywords : v.match_aliases) ?? []).filter(Boolean)

// ── 결제 확인 · 입금대장에서 쓰는 통장 키워드 (2026-11-25 사용자 결정 — docs/payment-track.md) ──
// 통장 입금을 주문에 확정할 때 입금자 표기를 매출처 통장 키워드로 기록(체크 칸 기본 체크)하고, 후보 판정에 "키워드 일치"로 쓴다.
// 뜻 없는 말(이체 · 입금 …)과 2글자 미만은 기록하지 않는다.
const KEYWORD_STOP = new Set(['이체', '입금', '송금', '대체', '타행', '타행이체', '계좌이체', '인터넷', '모바일', '인터넷뱅킹', '모바일뱅킹', 'cms', '펌뱅킹', '창구', '현금'])
export const normKeyword = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toLowerCase()

export function keywordHit(who: string | null | undefined, keywords: string[]): string | null {
  const w = normKeyword(who)
  if (!w) return null
  for (const k of keywords) { const n = normKeyword(k); if (n.length >= 2 && w.includes(n)) return k }
  return null
}

// 입금자 표기를 키워드로 기록할 만한가 — 매출처 이름과 같거나 이미 있는 키워드에 걸리면 기록할 필요가 없다
export function learnableKeyword(who: string | null | undefined, vendorName: string | null | undefined, keywords: string[]): string | null {
  const t = (who ?? '').trim()
  const n = normKeyword(t)
  if (n.length < 2 || KEYWORD_STOP.has(n) || /^\d+$/.test(n)) return null
  if (vendorName && normKeyword(vendorName) === n) return null
  if (keywordHit(t, keywords)) return null
  return t.slice(0, 40)
}

export async function loadBankKeywords(admin: SupabaseClient, vendorIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  const ids = Array.from(new Set(vendorIds.filter(Boolean)))
  if (!ids.length) return out
  const has = await bankKeywordsColumnExists(admin)
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await (admin.from('vendors').select((has ? 'id, bank_keywords, match_aliases' : 'id, match_aliases') as string).in('id', ids.slice(i, i + 150)) as unknown as
      PromiseLike<{ data: { id: string; bank_keywords?: string[] | null; match_aliases?: string[] | null }[] | null }>)
    for (const v of data ?? []) out.set(v.id, bankKeywordsOf(v, has))
  }
  return out
}

// 기록 — 이미 있으면 그대로(성공으로 본다). 실패해도 확정 자체에는 영향을 주지 않는다(호출부에서 결과만 안내)
export async function addBankKeyword(admin: SupabaseClient, vendorId: string, text: string): Promise<{ added: boolean; keyword: string | null }> {
  const has = await bankKeywordsColumnExists(admin)
  const { data: v } = await (admin.from('vendors').select((has ? 'name, bank_keywords, match_aliases' : 'name, match_aliases') as string).eq('id', vendorId).maybeSingle() as unknown as
    PromiseLike<{ data: { name: string; bank_keywords?: string[] | null; match_aliases?: string[] | null } | null }>)
  if (!v) return { added: false, keyword: null }
  const existing = bankKeywordsOf(v, has)
  const kw = learnableKeyword(text, v.name, existing)
  if (!kw) return { added: false, keyword: null }
  const { error } = await admin.from('vendors').update({ [has ? 'bank_keywords' : 'match_aliases']: [...existing, kw] }).eq('id', vendorId)
  return { added: !error, keyword: error ? null : kw }
}
