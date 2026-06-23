// Supabase 프로젝트의 PostgREST 설정(max-rows, 기본 1000)을 넘는 단일 조회는
// 서버가 조용히 잘라서 반환한다 — range()로 페이지를 나눠 끝까지 읽어야 안전하다.
const PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[] } | { error: string }> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1)
    if (error) return { error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return { data: rows }
}
