/**
 * 통합 테스트 (M8) — 신규 DB에서 전체 수명주기 검증. 오픈 리허설 겸용.
 *
 * 절차: 테스트 DB 생성 → migrate deploy → seed → API 기동 →
 *   조직/직원 → 연차 발생(독립 구현과 전수 대조) → 일정 → 출퇴근/보정 →
 *   휴가 → 초과근무 → 마감(스냅샷/가드) → 리포트 → Import → 비밀번호 변경
 *
 * 실행: pnpm test:integration (apps/api 에서)
 */
import { spawn, execSync } from 'node:child_process';
import ExcelJS from 'exceljs';

const DB_URL = 'postgresql://daolerp:daolerp_dev@localhost:5432/daolerp_test';
const PORT = 3100;
const B = `http://localhost:${PORT}/api`;
const ENV = { ...process.env, DATABASE_URL: DB_URL, API_PORT: String(PORT), JWT_SECRET: 'integration-test-secret', TZ: 'Asia/Seoul' };

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name} ${detail}`); }
}

const kstToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

/** 독립 연차 계산 구현 — 서비스 코드와 다른 방식으로 전수 대조 (기획서 10.4 검증 기준) */
function independentAccruals(hireKey, asOfKey) {
  const [hy, hm, hd] = hireKey.split('-').map(Number);
  const out = [];
  const fmt = (y, m0, d) => {
    const last = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
    return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  };
  for (let k = 1; k <= 11; k++) {
    const t = hy * 12 + (hm - 1) + k;
    const key = fmt(Math.floor(t / 12), t % 12, hd);
    if (key <= asOfKey) out.push({ date: key, days: 1 });
  }
  for (let n = 1; ; n++) {
    const t = hy * 12 + (hm - 1) + 12 * n;
    const key = fmt(Math.floor(t / 12), t % 12, hd);
    if (key > asOfKey) break;
    out.push({ date: key, days: Math.min(15 + Math.floor((n - 1) / 2), 25) });
  }
  return out;
}

async function api(path, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${B}${path}`, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}
const login = async (email, password) =>
  (await api('/auth/login', { method: 'POST', body: { email, password } })).body?.accessToken;

async function main() {
  console.log('== 0. 테스트 DB 준비 ==');
  execSync(`psql "postgresql://daolerp:daolerp_dev@localhost:5432/postgres" -c "DROP DATABASE IF EXISTS daolerp_test;" -c "CREATE DATABASE daolerp_test;"`, { stdio: 'pipe' });
  execSync('pnpm exec prisma migrate deploy', { env: ENV, stdio: 'pipe' });
  execSync('pnpm exec ts-node prisma/seed.ts', { env: ENV, stdio: 'pipe' });
  console.log('  DB 생성 + 마이그레이션 + 시드 완료');

  console.log('== 0b. API 기동 ==');
  const server = spawn('node', ['dist/apps/api/src/main.js'], { env: ENV, stdio: 'pipe' });
  let admin = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    admin = await login('admin@daolerp.local', 'admin1234!').catch(() => null);
    if (admin) break;
  }
  if (!admin) { server.kill(); throw new Error('API 기동 실패'); }
  console.log('  기동 완료');

  try {
    const today = kstToday();
    const ym = today.slice(0, 7);
    const [y, m] = ym.split('-').map(Number);
    const prevYm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;

    console.log('== 1. 조직/직원/계정 ==');
    const dept = (await api('/departments', { method: 'POST', token: admin, body: { name: '통합테스트팀', headEmployeeId: 1, reason: '통합 테스트' } })).body;
    check('부서 생성 (부서장=관리자)', dept?.id > 0);
    const HIRE = '2025-01-10';
    const emp = (await api('/employees', { method: 'POST', token: admin, body: { empNo: 'T0001', name: '테스트직원', hireDate: HIRE, departmentId: dept.id, jobGradeCode: 'E1', employmentTypeCode: 'FULL' } })).body;
    check('직원 생성', emp?.id > 0);
    await api('/users', { method: 'POST', token: admin, body: { email: 't@daolerp.local', password: 'test1234!', employeeId: emp.id, roleCodes: ['EMPLOYEE'] } });
    const tuser = await login('t@daolerp.local', 'test1234!');
    check('직원 로그인', !!tuser);
    const eff = (await api(`/employees/${emp.id}/effective-policies`, { token: admin })).body;
    check('정책 해석 = 전사 기본값(DEFAULT)', eff?.work?.source === 'DEFAULT' && eff?.leave?.source === 'DEFAULT');

    console.log('== 2. 연차 발생 — 독립 구현과 전수 대조 ==');
    const jobs = (await api('/scheduler/jobs', { token: admin })).body;
    const jobId = (n) => jobs.find((j) => j.name === n).id;
    await api(`/scheduler/jobs/${jobId('leave-grant')}/run`, { method: 'POST', token: admin });
    await api(`/scheduler/jobs/${jobId('leave-expire')}/run`, { method: 'POST', token: admin });
    const bal = (await api(`/leaves/balance/${emp.id}`, { token: admin })).body;
    const expected = independentAccruals(HIRE, today);
    const expGranted = expected.reduce((s, a) => s + a.days, 0);
    check(`발생 총량 전수 대조 (기대 ${expGranted}일)`, bal.summary.granted === expGranted, `실제 ${bal.summary.granted}`);
    check(`발생 건수 전수 대조 (기대 ${expected.length}건)`, bal.grants.length === expected.length, `실제 ${bal.grants.length}`);
    const dateMatch = expected.every((e) => bal.grants.some((g) => g.grantDate === e.date && g.days === e.days));
    check('발생일/일수 건별 전수 일치', dateMatch);
    const expExpired = expected.filter((e) => {
      const [ey, em, ed] = e.date.split('-').map(Number);
      const t = ey * 12 + (em - 1) + 12;
      const last = new Date(Date.UTC(Math.floor(t / 12), (t % 12) + 1, 0)).getUTCDate();
      const expKey = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-${String(Math.min(ed, last)).padStart(2, '0')}`;
      return expKey < today;
    }).reduce((s, e) => s + e.days, 0);
    check(`소멸 전수 대조 (기대 ${expExpired}일)`, bal.summary.expired === expExpired, `실제 ${bal.summary.expired}`);

    console.log('== 3. 근무일정 + 엔진 판정 표본 대조 ==');
    const [py, pm] = prevYm.split('-').map(Number);
    await api('/work-schedules/generate', { method: 'POST', token: admin, body: { employeeId: emp.id, year: py, month: pm } });
    await api('/work-schedules/generate', { method: 'POST', token: admin, body: { employeeId: emp.id, year: y, month: m } });
    const daysThis = (await api(`/attendance/daily/${emp.id}?from=${ym}-01&to=${today}`, { token: admin })).body;
    // 독립 대조: 과거 근무일(월~금, 휴일 아님)은 전부 ABSENT (기록 없음)
    const badVerdict = daysThis.filter((d) => d.dateKey < today).filter((d) => {
      const wd = new Date(d.dateKey).getUTCDay();
      const isWeekday = wd >= 1 && wd <= 5;
      return isWeekday ? !['ABSENT', 'LEAVE', 'DAYOFF'].includes(d.status) : d.status !== 'DAYOFF';
    });
    check('과거 판정 표본 대조 (주중=결근, 주말=휴무)', badVerdict.length === 0, JSON.stringify(badVerdict.slice(0, 2)));

    console.log('== 4. 출퇴근 + 보정 → 승인 → 엔진 재판정 ==');
    await api('/attendance/clock', { method: 'POST', token: tuser, body: { eventType: 'CLOCK_IN' } });
    const absentDay = daysThis.find((d) => d.status === 'ABSENT');
    if (absentDay) {
      const corr = (await api('/attendance/corrections', { method: 'POST', token: tuser, body: { date: absentDay.dateKey, clockIn: '09:00', clockOut: '18:00', reason: '체크 누락' } })).body;
      check('보정 신청', corr?.status === 'REQUESTED');
      const inbox = (await api('/approvals/inbox', { token: admin })).body;
      const ap = inbox.find((i) => i.approval.requestType === 'ATTENDANCE_CORRECTION' && i.approval.requestId === corr.id);
      check('승인함 도착 (부서장=관리자)', !!ap);
      await api(`/approvals/${ap.approval.id}/approve`, { method: 'POST', token: admin, body: { comment: 'ok' } });
      const after = (await api(`/attendance/daily/${emp.id}?from=${absentDay.dateKey}&to=${absentDay.dateKey}`, { token: admin })).body[0];
      check('보정 반영 → NORMAL 480분 (독립 계산 09~18-휴게60)', after.status === 'NORMAL' && after.workMinutes === 480, JSON.stringify(after));
    }

    console.log('== 5. 휴가 신청 → 승인 → LEAVE 판정 + 차감 ==');
    const future = (await api(`/attendance/daily/${emp.id}?from=${today}&to=${ym}-28`, { token: admin })).body.find((d) => d.dateKey > today && d.status === 'SCHEDULED');
    if (future) {
      const before = (await api(`/leaves/balance/${emp.id}`, { token: admin })).body.summary;
      const lr = (await api('/leaves/requests', { method: 'POST', token: tuser, body: { leaveTypeCode: 'ANNUAL', startDate: future.dateKey, endDate: future.dateKey, reason: '통합 테스트' } })).body;
      check('휴가 신청 1일 산정', lr?.days === 1, JSON.stringify(lr));
      const inbox = (await api('/approvals/inbox', { token: admin })).body;
      const ap = inbox.find((i) => i.approval.requestType === 'LEAVE' && i.approval.requestId === lr.id);
      await api(`/approvals/${ap.approval.id}/approve`, { method: 'POST', token: admin, body: {} });
      const day = (await api(`/attendance/daily/${emp.id}?from=${future.dateKey}&to=${future.dateKey}`, { token: admin })).body[0];
      check('승인 → 엔진 LEAVE 판정', day.status === 'LEAVE');
      const afterBal = (await api(`/leaves/balance/${emp.id}`, { token: admin })).body.summary;
      check('선입선출 차감 (used +1)', afterBal.used === before.used + 1, `before ${before.used} after ${afterBal.used}`);
    }

    console.log('== 6. 초과근무 → 승인 ==');
    const ot = (await api('/overtime/requests', { method: 'POST', token: tuser, body: { date: today, startTime: '18:00', endTime: '20:00', reason: '통합 테스트' } })).body;
    check('초과근무 신청 120분', ot?.expectedMinutes === 120);
    const inbox2 = (await api('/approvals/inbox', { token: admin })).body;
    const otAp = inbox2.find((i) => i.approval.requestType === 'OVERTIME' && i.approval.requestId === ot.id);
    await api(`/approvals/${otAp.approval.id}/approve`, { method: 'POST', token: admin, body: {} });
    const otAfter = (await api('/overtime/requests', { token: tuser })).body.find((r) => r.id === ot.id);
    check('승인 훅 → APPROVED', otAfter.status === 'APPROVED');

    console.log('== 7. 월 마감 — 검증 → 마감 → 가드 → 스냅샷 ==');
    const closeRes = (await api(`/closings/${prevYm}/close`, { method: 'POST', token: admin })).body;
    check('전월 마감 성공 (경고만)', closeRes.closed === true, JSON.stringify(closeRes.issues?.slice(0, 1)));
    const closing = (await api(`/closings/${prevYm}`, { token: admin })).body;
    check('스냅샷 생성', closing.status === 'CLOSED' && closing.snapshots.length >= 1);
    const guard = (await api('/attendance/corrections', { method: 'POST', token: tuser, body: { date: `${prevYm}-15`, clockIn: '09:00', reason: 'x' } }));
    check('마감 가드 — 마감월 보정 차단', guard.status === 400 && guard.body.message.includes('마감'));
    const report = (await api(`/reports/monthly/${prevYm}`, { token: admin })).body;
    check('리포트 출처 = SNAPSHOT', report.source === 'SNAPSHOT');
    const reportLive = (await api(`/reports/monthly/${ym}`, { token: admin })).body;
    check('당월 리포트 출처 = LIVE', reportLive.source === 'LIVE');

    console.log('== 8. Excel Import (dryRun → 확정) ==');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    ws.addRow(['사번', '이름', '입사일', '부서명', '직급코드', '고용형태코드']);
    ws.addRow(['T0002', '임포트직원', '2026-02-01', '통합테스트팀', 'E1', 'FULL']);
    ws.addRow(['T0003', '오류행', 'bad-date', '통합테스트팀', 'E1', 'FULL']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const form = new FormData();
    form.append('file', new Blob([buf]), 'emp.xlsx');
    const dry = (await api('/imports/employees', { method: 'POST', token: admin, form })).body;
    check('Import dryRun (1 유효 + 1 오류)', dry.valid === 1 && dry.invalid === 1 && dry.applied === 0, JSON.stringify(dry.rows?.map((r) => r.error)));
    const form2 = new FormData();
    form2.append('file', new Blob([buf]), 'emp.xlsx');
    const applied = (await api('/imports/employees?dryRun=false', { method: 'POST', token: admin, form: form2 })).body;
    check('Import 확정 반영 1건', applied.applied === 1);

    console.log('== 9. 비밀번호 변경 → 재로그인 ==');
    await api('/auth/change-password', { method: 'POST', token: tuser, body: { currentPassword: 'test1234!', newPassword: 'newpass1234!' } });
    check('구 비밀번호 로그인 실패', !(await login('t@daolerp.local', 'test1234!')));
    check('신 비밀번호 로그인 성공', !!(await login('t@daolerp.local', 'newpass1234!')));

    console.log('== 10. 접근 제어 회귀 ==');
    check('일반 직원 → 마감 실행 403', (await api(`/closings/${prevYm}/reopen`, { method: 'POST', token: await login('t@daolerp.local', 'newpass1234!'), body: { reason: 'x' } })).status === 403);
    check('미인증 → 401', (await api('/employees')).status === 401);
  } finally {
    server.kill();
  }

  console.log(`\n결과: ${passed} 통과 / ${failed} 실패`);
  if (failed > 0) {
    console.log('실패 항목:', failures.join(', '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
