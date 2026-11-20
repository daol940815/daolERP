// 백업용 엑셀 만들기 전용: 요청 밖에서 돌리므로 쿠키 · 헤더는 비어 있다.
const empty = {
  get: () => undefined,
  getAll: () => [],
  has: () => false,
  set: () => {},
  delete: () => {},
}
export async function cookies() { return empty }
export async function headers() { return new Headers() }
export async function draftMode() { return { isEnabled: false, enable() {}, disable() {} } }
