import { addMonthsClamped, computeAccruals } from './accrual-calculator';

const POLICY = { expireMonths: 12 };

describe('addMonthsClamped', () => {
  test('일반', () => expect(addMonthsClamped('2025-03-15', 1)).toBe('2025-04-15'));
  test('말일 클램프: 1/31 + 1개월 = 2/28', () =>
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28'));
  test('연도 넘김', () => expect(addMonthsClamped('2025-11-30', 3)).toBe('2026-02-28'));
});

describe('computeAccruals — 근로기준법 제60조', () => {
  test('1년 미만: 매월 응당일 1일씩, 기준일까지만', () => {
    // 2026-01-05 입사, 2026-07-08 기준 → 2/5, 3/5, 4/5, 5/5, 6/5, 7/5 = 6건
    const a = computeAccruals(3, '2026-01-05', '2026-07-08', POLICY);
    expect(a).toHaveLength(6);
    expect(a[0].grantDate).toBe('2026-02-05');
    expect(a[5].grantDate).toBe('2026-07-05');
    expect(a.every((x) => x.days === 1)).toBe(true);
  });

  test('월차는 최대 11일 + 1주년 15일', () => {
    // 2025-03-15 입사, 2026-07-08 기준 → 월차 11건(25-04-15~26-02-15) + 1주년(26-03-15) 15일
    const a = computeAccruals(2, '2025-03-15', '2026-07-08', POLICY);
    const monthly = a.filter((x) => x.grantKey.includes('MONTHLY'));
    const annual = a.filter((x) => x.grantKey.includes('ANNUAL'));
    expect(monthly).toHaveLength(11);
    expect(monthly[10].grantDate).toBe('2026-02-15');
    expect(annual).toHaveLength(1);
    expect(annual[0]).toMatchObject({ grantDate: '2026-03-15', days: 15, expireDate: '2027-03-15' });
  });

  test('가산: 3년차 16일, 5년차 17일 (2년마다 +1)', () => {
    const a = computeAccruals(1, '2020-01-01', '2026-07-08', POLICY);
    const annual = a.filter((x) => x.grantKey.includes('ANNUAL'));
    const byYear = Object.fromEntries(annual.map((x) => [x.grantDate.slice(0, 4), x.days]));
    expect(byYear['2021']).toBe(15); // 1년차
    expect(byYear['2022']).toBe(15); // 2년차
    expect(byYear['2023']).toBe(16); // 3년차
    expect(byYear['2025']).toBe(17); // 5년차
  });

  test('가산 상한 25일', () => {
    const a = computeAccruals(1, '2000-01-01', '2026-07-08', POLICY);
    const annual = a.filter((x) => x.grantKey.includes('ANNUAL'));
    const last = annual[annual.length - 1];
    expect(last.days).toBe(25); // 21년차 이상 25 캡
  });

  test('멱등키: 같은 입력이면 같은 grantKey', () => {
    const a1 = computeAccruals(2, '2025-03-15', '2026-07-08', POLICY);
    const a2 = computeAccruals(2, '2025-03-15', '2026-07-08', POLICY);
    expect(a1.map((x) => x.grantKey)).toEqual(a2.map((x) => x.grantKey));
  });
});
