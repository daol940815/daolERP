'use client'

// 내 정보 — 기본 정보 / 계정 / 내 업무 요약 (2026-10-01 사용자 확정: 권한 탭 없음, 급여 없음, 연락처만 본인 수정)
// 데이터는 /api/me/profile 1회. 비밀번호 변경은 계정 탭 안(옛 /me/password 흡수).
// 인사 · 총무의 직원 상세와 부품을 공유한다 — EmployeeBasicCard(읽기 전용 인사 정보)는 export.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { contactLabel } from '@/lib/contact-label'
import { kstTime, LEAVE_TYPE_LABEL, LEAVE_STATUS_LABEL, type LeaveType, type LeaveStatus } from '@/lib/attendance'

export type ProfileTab = 'basic' | 'account' | 'work'

export interface EmployeeRow {
  id: string
  name: string
  team: string | null
  position: string | null
  employment_type: 'regular' | 'parttime' | 'contract' | string
  hire_date: string | null
  work_start: string | null
  work_end: string | null
  is_active: boolean
  phone: string | null
  email: string | null
  login_id: string | null
}

interface Profile {
  linked: boolean
  employee: EmployeeRow | null
  account: { login_id: string | null; email: string | null; last_sign_in_at: string | null }
  today: string
  month: string
  attendance: { check_in_at: string | null; check_out_at: string | null } | null
  attendanceReady: boolean
  leaves: { id: string; leave_type: LeaveType; start_date: string; end_date: string; status: LeaveStatus }[]
  vendors: { vendor_id: string; name: string; is_primary: boolean }[]
  contacts: { contact_id: string; name: string; title: string | null; vendor_id: string; vendor_name: string; is_representative: boolean }[]
  worklogCount: number | null
  worklogs: { id: string; work_date: string; action: string; category: string | null; content: string }[]
  journal: { id: string; activity_date: string; activity_type: string; content: string; contact_name: string | null; vendor_name: string | null }[]
}

const EMPLOYMENT_LABEL: Record<string, { label: string; cls: string }> = {
  regular:  { label: '정규',      cls: 'bg-blue-100 text-blue-700' },
  contract: { label: '계약직',    cls: 'bg-teal-100 text-teal-700' },
  parttime: { label: '아르바이트', cls: 'bg-violet-100 text-violet-700' },
}
const LEAVE_STATUS_CLS: Record<string, string> = {
  requested: 'bg-amber-100 text-amber-700', approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700', canceled: 'bg-gray-100 text-gray-500',
}

const tenure = (hire: string | null, today: string) => {
  if (!hire) return null
  const a = new Date(hire), b = new Date(today)
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() < a.getDate()) months--
  if (months < 0) return null
  return `${Math.floor(months / 12)}년 ${months % 12}개월`
}
const fmtDT = (iso: string | null) => iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }).replace(/\. /g, '-').replace('.', '') : '-'

const Card = ({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-5">
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-bold text-gray-900">{title}</h2>
      {right && <div className="text-xs text-gray-500">{right}</div>}
    </div>
    {children}
  </div>
)
const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[110px_1fr] gap-y-2 text-sm py-1"><dt className="text-gray-500">{k}</dt><dd className="text-gray-900">{children}</dd></div>
)

// 읽기 전용 인사 정보 카드 — 인사 · 총무 직원 상세에서도 그대로 쓴다 (급여·편집은 그 트랙이 탭으로 추가)
export function EmployeeBasicCard({ emp, today, right }: { emp: EmployeeRow; today: string; right?: React.ReactNode }) {
  const et = EMPLOYMENT_LABEL[emp.employment_type] ?? { label: emp.employment_type, cls: 'bg-gray-100 text-gray-600' }
  const showTerm = emp.employment_type !== 'regular' || emp.work_start || emp.work_end
  return (
    <Card title="인사 정보" right={right}>
      <dl>
        <Row k="이름">{emp.name}</Row>
        <Row k="팀">{emp.team ?? <span className="text-gray-300">-</span>}</Row>
        <Row k="직위">{emp.position ?? <span className="text-gray-300">-</span>}</Row>
        <Row k="고용 형태"><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${et.cls}`}>{et.label}</span></Row>
        <Row k="입사일">{emp.hire_date ?? <span className="text-gray-300">-</span>}{emp.hire_date && tenure(emp.hire_date, today) && <span className="text-xs text-gray-400 ml-2">({tenure(emp.hire_date, today)})</span>}</Row>
        {showTerm && <Row k="근무 기간">{emp.work_start ?? '?'} ~ {emp.work_end ?? '진행 중'}</Row>}
        <Row k="상태"><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${emp.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{emp.is_active ? '재직' : '비활성'}</span></Row>
      </dl>
    </Card>
  )
}

export default function ProfileClient({ tab }: { tab: ProfileTab }) {
  const [p, setP] = useState<Profile | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    const res = await fetch('/api/me/profile', { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) { setErr(json.error ?? '조회 실패'); return }
    setP(json)
  }, [])
  useEffect(() => { load() }, [load])

  if (err) return <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{err}</div>
  if (!p) return <div className="text-center py-20 text-gray-400">로딩 중...</div>
  if (!p.linked || !p.employee) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-600">
        이 로그인 계정은 직원 정보와 연결되어 있지 않습니다. 인사 · 총무 담당자에게 직원 · 계정 · 권한 화면에서 연결을 요청하세요.
        {tab === 'account' && <div className="mt-6"><PasswordForm /></div>}
      </div>
    )
  }

  if (tab === 'account') return <AccountTab p={p} />
  if (tab === 'work') return <WorkTab p={p} />
  return <BasicTab p={p} onSaved={load} />
}

// ── 기본 정보 ─────────────────────────────────────────────
function BasicTab({ p, onSaved }: { p: Profile; onSaved: () => void }) {
  const emp = p.employee!
  const [phone, setPhone] = useState(emp.phone ?? '')
  const [email, setEmail] = useState(emp.email ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const dirty = phone !== (emp.phone ?? '') || email !== (emp.email ?? '')

  const save = async () => {
    setBusy(true); setMsg(null)
    const res = await fetch('/api/me/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, email }) })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) { setMsg(json.error ?? '저장 실패'); return }
    setMsg('연락처가 저장되었습니다.'); onSaved()
  }
  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900'
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <EmployeeBasicCard emp={emp} today={p.today} right="인사 · 총무에서 관리" />
      <Card title="연락처" right="본인 수정 가능">
        {msg && <div className={`mb-3 px-3 py-2 text-sm rounded-lg ${msg.includes('저장되었') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg}</div>}
        <label className="block mb-3">
          <span className="text-xs font-medium text-gray-600">휴대전화</span>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="010-0000-0000" className={`${inputCls} mt-1`} />
        </label>
        <label className="block mb-4">
          <span className="text-xs font-medium text-gray-600">이메일</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" className={`${inputCls} mt-1`} />
        </label>
        <div className="flex gap-2">
          <button onClick={save} disabled={busy || !dirty} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40">{busy ? '저장 중...' : '저장'}</button>
          <button onClick={() => { setPhone(emp.phone ?? ''); setEmail(emp.email ?? ''); setMsg(null) }} disabled={!dirty} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">취소</button>
        </div>
        <p className="text-xs text-gray-400 mt-4">연락처는 직원 마스터 한 곳에 저장되어 직원 · 계정 · 권한 화면과 거래처 담당 표시에 같이 반영됩니다. 팀 · 직위 · 입사일 변경은 인사 · 총무 담당자에게 요청하세요.</p>
      </Card>
    </div>
  )
}

// ── 계정 ─────────────────────────────────────────────────
function AccountTab({ p }: { p: Profile }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="로그인 계정">
        <dl>
          <Row k="로그인 ID">{p.account.login_id ?? <span className="text-gray-400">{p.account.email ?? '-'}</span>}<span className="text-xs text-gray-400 ml-2">변경은 인사 · 총무</span></Row>
          <Row k="계정 상태"><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${p.employee?.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{p.employee?.is_active ? '정상' : '비활성'}</span></Row>
          <Row k="마지막 로그인">{fmtDT(p.account.last_sign_in_at)}</Row>
        </dl>
        <p className="text-xs text-gray-400 mt-4">로그인은 브라우저를 닫으면 풀립니다(회사 정책). 아이디만 기억하고 비밀번호는 저장하지 않습니다.</p>
      </Card>
      <Card title="비밀번호 변경"><PasswordForm /></Card>
    </div>
  )
}

const MIN_LEN = 6
// 본인 비밀번호 변경 — 현재 비밀번호로 재인증(본인 확인) → auth.updateUser. 서비스 키·관리자 API 없음.
export function PasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null)
    if (next.length < MIN_LEN) { setError(`새 비밀번호는 ${MIN_LEN}자 이상이어야 합니다.`); return }
    if (next !== confirm) { setError('새 비밀번호와 확인 입력이 서로 다릅니다.'); return }
    if (next === current) { setError('현재 비밀번호와 다른 비밀번호를 입력하세요.'); return }
    setBusy(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) { setBusy(false); setError('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.'); return }
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password: current })
    if (authErr) {
      setBusy(false)
      setError(authErr.message.includes('Invalid login credentials') ? '현재 비밀번호가 올바르지 않습니다.'
        : authErr.message.includes('Too many requests') ? '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'
        : '본인 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      return
    }
    const { error: updErr } = await supabase.auth.updateUser({ password: next })
    setBusy(false)
    if (updErr) { setError(/password/i.test(updErr.message) ? `비밀번호 규칙에 맞지 않습니다 (${MIN_LEN}자 이상). ${updErr.message}` : `변경 실패: ${updErr.message}`); return }
    setDone(true); setCurrent(''); setNext(''); setConfirm('')
  }
  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900'
  if (done) {
    return (
      <div>
        <p className="text-sm text-green-700 font-medium">비밀번호가 변경되었습니다.</p>
        <p className="text-xs text-gray-500 mt-1">다음 로그인부터 새 비밀번호를 사용하세요. 지금 세션은 그대로 유지됩니다.</p>
        <button onClick={() => setDone(false)} className="mt-3 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">다시 변경</button>
      </div>
    )
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}
      <label className="block"><span className="text-xs font-medium text-gray-600">현재 비밀번호</span>
        <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required className={`${inputCls} mt-1`} /></label>
      <label className="block"><span className="text-xs font-medium text-gray-600">새 비밀번호 ({MIN_LEN}자 이상)</span>
        <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} required minLength={MIN_LEN} className={`${inputCls} mt-1`} /></label>
      <label className="block"><span className="text-xs font-medium text-gray-600">새 비밀번호 확인</span>
        <input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={MIN_LEN} className={`${inputCls} mt-1`} /></label>
      <button type="submit" disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">{busy ? '변경 중...' : '비밀번호 변경'}</button>
      <p className="text-xs text-gray-400">현재 비밀번호로 본인 확인 후 변경됩니다. 잊었으면 인사 · 총무 담당자(직원 · 계정 · 권한 화면)에게 재설정을 요청하세요.</p>
    </form>
  )
}

// ── 내 업무 요약 ──────────────────────────────────────────
function WorkTab({ p }: { p: Profile }) {
  const inT = kstTime(p.attendance?.check_in_at ?? null)
  const outT = kstTime(p.attendance?.check_out_at ?? null)
  const pending = p.leaves.filter(l => l.status === 'requested').length
  const kpi = (k: string, v: React.ReactNode, s?: string) => (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3"><p className="text-xs text-gray-500">{k}</p><p className="text-lg font-bold mt-0.5">{v}</p>{s && <p className="text-[11px] text-gray-400 mt-0.5">{s}</p>}</div>
  )
  const Empty = ({ t }: { t: string }) => <p className="text-xs text-gray-400 py-3">{t}</p>
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpi('오늘 근태', p.attendanceReady ? (inT ? `출근 ${inT}` : '미출근') : '-', p.attendanceReady ? (outT ? `퇴근 ${outT}` : inT ? '퇴근 전' : '사이드바 상단에서 출근 체크') : '근태 기능 준비 전')}
        {kpi('휴가 신청', `${p.leaves.length}건`, pending ? `승인 대기 ${pending}건` : '최근 5건 기준')}
        {kpi('담당 거래처', `${p.vendors.length}곳`, `담당 고객 ${p.contacts.length}명`)}
        {kpi(`${p.month.slice(5)}월 업무일지`, p.worklogCount === null ? '-' : `${p.worklogCount}건`, p.worklogs[0] ? `마지막 ${p.worklogs[0].work_date}` : undefined)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="근태 · 휴가" right={<Link href="/hr/attendance" className="text-blue-600 hover:underline">근태 · 휴가 화면 →</Link>}>
          {p.leaves.length === 0 ? <Empty t="휴가 신청 기록이 없습니다." /> : (
            <table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">구분</th><th className="py-1.5 font-medium">기간</th><th className="py-1.5 font-medium">상태</th></tr></thead>
              <tbody>{p.leaves.map(l => (
                <tr key={l.id} className="border-b border-gray-50 last:border-0"><td className="py-1.5">{LEAVE_TYPE_LABEL[l.leave_type] ?? l.leave_type}</td>
                  <td className="py-1.5 text-gray-600 tabular-nums">{l.start_date}{l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ''}</td>
                  <td className="py-1.5"><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${LEAVE_STATUS_CLS[l.status] ?? 'bg-gray-100 text-gray-600'}`}>{LEAVE_STATUS_LABEL[l.status] ?? l.status}</span></td></tr>
              ))}</tbody></table>
          )}
        </Card>
        <Card title="담당 거래처" right={<Link href="/sales-hub?mine=1" className="text-blue-600 hover:underline">내 고객 →</Link>}>
          {p.vendors.length === 0 ? <Empty t="현재 담당으로 배정된 거래처가 없습니다." /> : (
            <ul className="text-sm divide-y divide-gray-50">
              {p.vendors.slice(0, 8).map(v => (
                <li key={v.vendor_id} className="py-1.5 flex items-center gap-2">
                  <Link href={`/sales-hub/${v.vendor_id}`} className="text-gray-900 hover:underline truncate">{v.name}</Link>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${v.is_primary ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-500'}`}>{v.is_primary ? '주담당' : '부담당'}</span>
                </li>
              ))}
              {p.vendors.length > 8 && <li className="py-1.5 text-xs text-gray-400">외 {p.vendors.length - 8}곳</li>}
            </ul>
          )}
        </Card>
        <Card title="담당 고객" right={<Link href="/sales-hub/contacts" className="text-blue-600 hover:underline">고객 관리 →</Link>}>
          {p.contacts.length === 0 ? <Empty t="담당 거래처에 등록된 거래처 담당자가 없습니다." /> : (
            <ul className="text-sm divide-y divide-gray-50">
              {p.contacts.slice(0, 8).map(c => (
                <li key={`${c.contact_id}-${c.vendor_id}`} className="py-1.5 flex items-center gap-2">
                  <Link href={`/sales-hub/contacts/${c.contact_id}`} className="text-gray-900 hover:underline">{contactLabel(c.name, c.title)}</Link>
                  <span className="text-xs text-gray-400 truncate">{c.vendor_name}</span>
                  {c.is_representative && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">대표</span>}
                </li>
              ))}
              {p.contacts.length > 8 && <li className="py-1.5 text-xs text-gray-400">외 {p.contacts.length - 8}명</li>}
            </ul>
          )}
        </Card>
        <Card title="최근 업무일지" right={<Link href="/me/worklog" className="text-blue-600 hover:underline">업무일지 →</Link>}>
          {p.worklogCount === null ? <Empty t="업무일지 기능 준비 전입니다." /> : p.worklogs.length === 0 ? <Empty t="이번 달 업무일지가 없습니다." /> : (
            <ul className="text-sm divide-y divide-gray-50">
              {p.worklogs.map(w => (
                <li key={w.id} className="py-1.5 flex gap-3"><span className="text-xs text-gray-400 tabular-nums shrink-0 pt-0.5">{w.work_date.slice(5)}</span><span className="text-gray-800 truncate">{w.content}</span></li>
              ))}
            </ul>
          )}
        </Card>
        {p.journal.length > 0 && (
          <Card title="최근 영업일지" right={<Link href="/me/journal" className="text-blue-600 hover:underline">영업일지 →</Link>}>
            <ul className="text-sm divide-y divide-gray-50">
              {p.journal.map(j => (
                <li key={j.id} className="py-1.5 flex gap-3"><span className="text-xs text-gray-400 tabular-nums shrink-0 pt-0.5">{j.activity_date.slice(5)}</span>
                  <span className="text-gray-800 truncate">{[j.vendor_name, j.contact_name ? contactLabel(j.contact_name) : null].filter(Boolean).join(' · ')}{j.vendor_name || j.contact_name ? ' — ' : ''}{j.content}</span></li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <p className="text-xs text-gray-400">각 카드의 숫자는 해당 화면과 같은 원본(근태 기록 · 담당 배정 · 업무일지)을 쓰므로 어긋나지 않습니다. 담당 고객은 내 담당 거래처에 현재 배정된 거래처 담당자입니다.</p>
    </div>
  )
}
