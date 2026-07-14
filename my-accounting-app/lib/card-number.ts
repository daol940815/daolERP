// 카드번호 정규화 비교 키
//
// 카드매출 명세서의 카드번호는 가운데가 마스킹되어 온다(예: 4289-09**-****-5208,
// 428909******0928). 거래처에 학습해 두는 번호는 전체 16자리일 수도, 마스킹
// 형태일 수도 있다. 완전일치 비교로는 서로 매칭되지 않으므로,
// "앞 6자리 + 뒤 4자리"를 비교 키로 쓴다 (카드 BIN + 끝번호 — 실데이터 검증에서
// 이 키의 충돌 0건 확인).

export function cardNumberKey(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).replace(/[^0-9*]/g, '')   // 숫자·마스킹 문자만 남김
  const digitCount = (s.match(/[0-9]/g) ?? []).length
  if (digitCount < 10) return null                 // 앞6+뒤4를 확보할 수 없는 값

  const lead = s.match(/^([0-9]{6})/)?.[1]         // 앞 6자리가 연속 숫자여야 함
  const tail = s.match(/([0-9]{4})$/)?.[1]         // 뒤 4자리
  if (!lead || !tail) return null
  return `${lead}|${tail}`
}
