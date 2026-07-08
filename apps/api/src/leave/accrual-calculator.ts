/**
 * 연차 발생 계산 — 순수 함수 (기획서 4.5.2, 근로기준법 제60조. 입사일 기준 — 결정 #1).
 * DB 접근 없음. 배치는 이 결과와 기존 grants(grantKey)를 대조해 누락분만 생성한다 (멱등).
 *
 * 규칙:
 *  - 1년 미만: 1개월 개근 시 1일, 최대 11일 (입사 응당일마다)
 *  - 1년 이상: 매 입사 기념일에 15일 + 최초 1년 초과 후 매 2년마다 1일 가산, 최대 25일
 *  - 개근/출근율 80% 조건은 충족 가정 — 미충족자는 HR 수동 조정으로 처리 (운영 정책)
 */

export interface AccrualPolicyInput {
  expireMonths: number; // 사용기한 (발생일로부터, 개월)
}

export interface Accrual {
  grantKey: string; // "{employeeId}:{MONTHLY|ANNUAL}:{grantDate}"
  grantDate: string; // 'YYYY-MM-DD'
  days: number;
  expireDate: string;
  reason: string;
}

/** 'YYYY-MM-DD' + n개월 (말일 클램프: 1/31 + 1개월 = 2/28) */
export function addMonthsClamped(dateKey: string, months: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const totalMonths = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(totalMonths / 12);
  const nm = totalMonths % 12; // 0-based
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

export function computeAccruals(
  employeeId: number,
  hireDateKey: string,
  asOfKey: string,
  policy: AccrualPolicyInput,
): Accrual[] {
  const accruals: Accrual[] = [];

  // 1년 미만 월차: 입사 후 1~11개월 응당일
  for (let k = 1; k <= 11; k++) {
    const grantDate = addMonthsClamped(hireDateKey, k);
    if (grantDate > asOfKey) break;
    accruals.push({
      grantKey: `${employeeId}:MONTHLY:${grantDate}`,
      grantDate,
      days: 1,
      expireDate: addMonthsClamped(grantDate, policy.expireMonths),
      reason: `입사 ${k}개월 개근 연차 (근로기준법 제60조 제2항)`,
    });
  }

  // 1년 이상: 매 기념일 15 + 가산 (2년마다 +1, 최대 25)
  for (let n = 1; ; n++) {
    const grantDate = addMonthsClamped(hireDateKey, 12 * n);
    if (grantDate > asOfKey) break;
    const days = Math.min(15 + Math.floor((n - 1) / 2), 25);
    accruals.push({
      grantKey: `${employeeId}:ANNUAL:${grantDate}`,
      grantDate,
      days,
      expireDate: addMonthsClamped(grantDate, policy.expireMonths),
      reason: `근속 ${n}년차 연차 (근로기준법 제60조 제1항${days > 15 ? '·제4항 가산' : ''})`,
    });
  }

  return accruals;
}
