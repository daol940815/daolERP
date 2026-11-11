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
