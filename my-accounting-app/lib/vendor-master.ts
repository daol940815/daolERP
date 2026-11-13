// 거래처 마스터 공통 유틸 — 정책: docs/vendor-master-policy.md
// 이름 정규화(§3)와 중복 후보 탐지의 단일 기준. 모든 매칭 기능은 이 규칙을 공유한다.

// 관용 동의어 사전 (정규화 후 적용) — 추가는 정책 문서와 함께 관리
const SYNONYMS: [string, string][] = [
  ['종합금융센터', '금융센터'],
  ['keb하나은행', '하나은행'],
]

const LEGAL_RE = /주식회사|\(주\)|㈜|\(유\)|유한회사|유한책임회사|\(재\)|\(사\)|\(합\)/g
const SPECIAL_RE = /[\s\-_.,·()[\]'"!@#&+/\\]/g

// 거래처 이름 정규화 — 법인격·공백·특수문자·대소문자 무시 + 동의어 치환
export function normalizeMasterName(s: string | null | undefined): string {
  let n = (s ?? '').toLowerCase().replace(LEGAL_RE, '').replace(SPECIAL_RE, '').trim()
  for (const [from, to] of SYNONYMS) n = n.split(from).join(to)
  return n
}

// 같은 이름(정규화 기준) 매출처 찾기 — 매출처 상세 머리의 '같은 이름 매출처' 안내 (2026-11-12)
// 중복 거래처가 둘로 나뉘면 주문은 한쪽 상세에만 보인다(예: 주식회사 한국아이티평가원 / (주)한국아이티평가원).
// 병합된 거래처는 제외. 주문 수 = 별칭 경유(매출처 상세와 같은 기준).
export interface SameNameVendor { id: string; name: string; is_active: boolean; order_count: number }

export async function findSameNameVendors(
  admin: import('@supabase/supabase-js').SupabaseClient,
  vendorId: string,
  name: string,
): Promise<SameNameVendor[]> {
  const key = normalizeMasterName(name)
  if (key.length < 2) return []
  // 후보 좁히기: 법인격을 뺀 이름의 조각(2자 이상)을 모두 부분 일치(AND) → 정규화 이름으로 확정
  const tokens = name.replace(LEGAL_RE, ' ').split(SPECIAL_RE).filter(t => t.length >= 2)
  if (!tokens.length) return []
  let q = admin.from('vendors').select('id, name, is_active, status').neq('id', vendorId)
  for (const t of tokens) q = q.ilike('name', `%${t.replace(/[%_\\]/g, m => `\\${m}`)}%`)
  const { data, error } = await q.limit(200)
  if (error || !data) return []
  const hits = data.filter(v => v.status !== 'merged' && normalizeMasterName(v.name as string) === key)
  if (!hits.length) return []
  const { data: aliases } = await admin.from('erp_vendor_aliases')
    .select('id, vendor_id').eq('alias_type', 'customer').in('vendor_id', hits.map(v => v.id as string))
  const aliasVendor = new Map((aliases ?? []).map(a => [a.id as string, a.vendor_id as string]))
  const counts = new Map<string, number>()
  if (aliasVendor.size) {
    const ids = Array.from(aliasVendor.keys())
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100)
      const r = await Promise.all(slice.map(id => admin.from('erp_orders')
        .select('id', { count: 'exact', head: true }).eq('customer_alias_id', id)))
      r.forEach((x, j) => {
        const vid = aliasVendor.get(slice[j])!
        counts.set(vid, (counts.get(vid) ?? 0) + (x.count ?? 0))
      })
    }
  }
  return hits.map(v => ({
    id: v.id as string, name: v.name as string, is_active: v.is_active !== false, order_count: counts.get(v.id as string) ?? 0,
  }))
}
