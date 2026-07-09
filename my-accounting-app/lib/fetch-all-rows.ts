// Supabase 프로젝트의 PostgREST 설정(max-rows, 기본 1000)을 넘는 단일 조회는
// 서버가 조용히 잘라서 반환한다 — range()로 페이지를 나눠 끝까지 읽어야 안전하다.
const PAGE_SIZE = 1000

// 일시적 네트워크 오류(keep-alive 소켓 끊김 등)는 페이지 단위로 재시도한다.
// 요청이 많은 라우트(자동매칭 등)는 수천 요청 중 한 번의 blip으로 전체가 죽었다.
const TRANSIENT = /fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|socket|network|terminated/i
const RETRIES = 3

export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[] } | { error: string }> {
  const rows: T[] = []
  let from = 0
  while (true) {
    let data: T[] | null = null
    let error: { message: string } | null = null
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      ;({ data, error } = await buildPage(from, from + PAGE_SIZE - 1))
      if (!error || !TRANSIENT.test(error.message) || attempt === RETRIES) break
      await new Promise(r => setTimeout(r, 400 * attempt))
    }
    if (error) return { error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return { data: rows }
}
