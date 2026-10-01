'use client'

import { useEffect, useState } from 'react'
import { GROUP_KEYS, GROUP_LABELS, type GroupKey, type PermLevel, type Permissions } from '@/lib/permissions'

// 직원 권한 편집 패널 — 그룹 8 × 없음/조회/수정 + 별도 잠금 2 + 승인권 + 마스터 + 팀·고용형태·근무기간.
// 마스터 계정만 저장할 수 있고(API가 다시 검사), 그 외는 읽기 전용으로 본다.

export interface PermEmp {
  id: string
  name: string
  team: string | null
  employment_type: 'regular' | 'parttime' | null
  work_start: string | null
  work_end: string | null
  is_master: boolean | null
  permissions: Permissions | null
  can_approve: boolean | null
  can_view_salary: boolean | null
  can_view_payment_info: boolean | null
  login_id: string | null
  position: string | null
}

const TEAMS = ['영업팀', '영업지원팀', '경영지원팀']
const AREA_OF: Record<GroupKey, string> = {
  customers: '영업 · 주문', orders: '영업 · 주문', collections: '영업 · 주문',
  accounting: '회계 · 재무', closing: '회계 · 재무', tools: '회계 · 재무',
  hr: '인사 · 총무', mgmt: '경영 현황',
}
const SCREENS: Record<GroupKey, string> = {
  customers: '내 고객 · 고객 관리 · 매출처 관리 · 매입처 관리',
  orders: '상담일지 · 주문 · 발주서 · 품목 · 샘플 재고',
  collections: '수금 대상 · 입금 매칭 · 계산서 발행 대상 · 매입 결제 예외',
  accounting: '업로드 · 통장·카드·계산서 내역 · 현금영수증 · 미수금·미지급금 관리',
  closing: '월별 손익 · 부가세 · 분개 · 원장 · 기초잔액 · 계정과목',
  tools: '연결 키워드 · 중복 정리 · 정산 대조 · 이중계상 · VIP 선결제',
  hr: '직원·계정·권한 · 근태 현황 · 휴가 승인',
  mgmt: '대시보드 · 자금·계좌 · 대출 · 매출 현황 (조회 전용)',
}

interface LogRow {
  id: string; changed_at: string; note: string | null
  before_state: Record<string, unknown>; after_state: Record<string, unknown>
  changer: { name: string } | { name: string }[] | null
}

export default function PermissionPanel({ emp, others, canEdit, onClose, onSaved }: {
  emp: PermEmp
  others: PermEmp[]
  canEdit: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [team, setTeam] = useState(emp.team ?? '')
  const [employment, setEmployment] = useState<'regular' | 'parttime'>(emp.employment_type === 'parttime' ? 'parttime' : 'regular')
  const [workStart, setWorkStart] = useState(emp.work_start ?? '')
  const [workEnd, setWorkEnd] = useState(emp.work_end ?? '')
  const [isMaster, setIsMaster] = useState(emp.is_master === true)
  const [perm, setPerm] = useState<Record<GroupKey, PermLevel>>(() =>
    Object.fromEntries(GROUP_KEYS.map(k => [k, emp.permissions?.[k] ?? 'none'])) as Record<GroupKey, PermLevel>)
  const [approve, setApprove] = useState(emp.can_approve === true)
  const [salary, setSalary] = useState(emp.can_view_salary === true)
  const [payment, setPayment] = useState(emp.can_view_payment_info === true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogRow[]>([])

  useEffect(() => {
    fetch('/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'permission_logs', id: emp.id }) })
      .then(r => r.json()).then(j => setLogs(j.logs ?? [])).catch(() => null)
  }, [emp.id])

  const copyFrom = (id: string) => {
    const src = others.find(o => o.id === id)
    if (!src) return
    setPerm(Object.fromEntries(GROUP_KEYS.map(k => [k, src.permissions?.[k] ?? 'none'])) as Record<GroupKey, PermLevel>)
    setApprove(src.can_approve === true); setSalary(src.can_view_salary === true); setPayment(src.can_view_payment_info === true)
    setMsg(`${src.name} 님의 권한을 복사했습니다 (마스터 여부는 복사하지 않음). 저장을 눌러 확정하세요.`)
  }

  const save = async () => {
    setBusy(true); setMsg(null)
    const res = await fetch('/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set_permissions', id: emp.id, team: team || null, employment_type: employment,
        work_start: workStart || null, work_end: workEnd || null, is_master: isMaster, permissions: perm,
        can_approve: approve, can_view_salary: salary, can_view_payment_info: payment, note: note || null,
      }) })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMsg(json.error ?? '저장 실패'); return }
    onSaved()
  }

  const Radio = ({ g, lv }: { g: GroupKey; lv: PermLevel }) => {
    const disabled = !canEdit || (g === 'mgmt' && lv === 'edit')
    const on = perm[g] === lv
    return (
      <td className="text-center py-2">
        <input type="radio" name={`perm-${g}`} checked={on} disabled={disabled}
          onChange={() => setPerm(p => ({ ...p, [g]: lv }))}
          className={disabled ? 'opacity-40' : ''} />
      </td>
    )
  }
  const Toggle = ({ v, set, label, hint }: { v: boolean; set: (b: boolean) => void; label: string; hint: string }) => (
    <tr className="border-b border-gray-50">
      <td className="py-2 px-3 font-medium">{label}</td>
      <td colSpan={3} className="text-center"><input type="checkbox" checked={v} disabled={!canEdit} onChange={e => set(e.target.checked)} /></td>
      <td className="py-2 px-3 text-[11px] text-gray-400">{hint}</td>
    </tr>
  )
  const inp = 'border border-gray-300 rounded px-2 py-1 text-xs'
  const changerName = (l: LogRow) => Array.isArray(l.changer) ? l.changer[0]?.name : l.changer?.name

  let lastArea = ''
  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-start justify-end" onClick={onClose}>
      <div className="bg-white h-full w-[720px] max-w-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3 sticky top-0 bg-white">
          <div>
            <div className="text-base font-bold">
              {emp.name}
              {emp.is_master && <span className="ml-2 px-2 py-0.5 rounded-full bg-slate-900 text-white text-[10px] font-semibold">마스터</span>}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {[emp.team, emp.position].filter(Boolean).join(' · ') || '팀 미지정'}{emp.login_id ? ` · ID ${emp.login_id}` : ' · 계정 없음'}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {canEdit && others.length > 0 && (
              <select className={inp} defaultValue="" onChange={e => { if (e.target.value) copyFrom(e.target.value); e.target.value = '' }}>
                <option value="">다른 직원 권한 복사…</option>
                {others.map(o => <option key={o.id} value={o.id}>{o.name}{o.team ? ` (${o.team})` : ''}</option>)}
              </select>
            )}
            <button onClick={onClose} className="text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg">닫기</button>
            {canEdit && (
              <button onClick={save} disabled={busy} className="text-xs px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold disabled:opacity-50">
                {busy ? '저장 중…' : '저장'}
              </button>
            )}
          </div>
        </div>

        {msg && <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-amber-50 text-amber-800 text-xs">{msg}</div>}
        {!canEdit && <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-slate-50 text-slate-600 text-xs">권한 편집은 마스터 계정만 할 수 있습니다 (읽기 전용).</div>}

        <div className="px-5 py-4 grid grid-cols-2 lg:grid-cols-4 gap-3 border-b border-gray-100">
          <div>
            <label className="block text-[11px] text-gray-500 font-semibold mb-1">팀</label>
            <input list="team-options" value={team} disabled={!canEdit} onChange={e => setTeam(e.target.value)} className={`${inp} w-full`} />
            <datalist id="team-options">{TEAMS.map(t => <option key={t} value={t} />)}</datalist>
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 font-semibold mb-1">고용 형태</label>
            <select value={employment} disabled={!canEdit} onChange={e => setEmployment(e.target.value as 'regular' | 'parttime')} className={`${inp} w-full`}>
              <option value="regular">정규</option>
              <option value="parttime">아르바이트</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 font-semibold mb-1">근무 시작</label>
            <input type="date" value={workStart} disabled={!canEdit} onChange={e => setWorkStart(e.target.value)} className={`${inp} w-full`} />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 font-semibold mb-1">근무 종료 <span className="font-normal text-gray-400">(경과 시 로그인 차단)</span></label>
            <input type="date" value={workEnd} disabled={!canEdit} onChange={e => setWorkEnd(e.target.value)} className={`${inp} w-full`} />
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
              <th className="py-2 px-3 text-left font-medium">권한 단위</th>
              <th className="py-2 w-16 font-medium">없음</th>
              <th className="py-2 w-16 font-medium">조회</th>
              <th className="py-2 w-16 font-medium">수정</th>
              <th className="py-2 px-3 text-left font-medium">포함되는 화면</th>
            </tr>
          </thead>
          <tbody>
            {GROUP_KEYS.map(g => {
              const areaRow = AREA_OF[g] !== lastArea
              lastArea = AREA_OF[g]
              return (
                <>
                  {areaRow && (
                    <tr key={`a-${g}`} className="bg-gray-50/70"><td colSpan={5} className="py-1.5 px-3 text-[11px] font-bold text-gray-500">{AREA_OF[g]}</td></tr>
                  )}
                  <tr key={g} className="border-b border-gray-50">
                    <td className="py-2 px-3 font-medium">{GROUP_LABELS[g]}</td>
                    <Radio g={g} lv="none" /><Radio g={g} lv="view" /><Radio g={g} lv="edit" />
                    <td className="py-2 px-3 text-[11px] text-gray-400">{SCREENS[g]}</td>
                  </tr>
                </>
              )
            })}
            <tr className="bg-gray-50/70"><td colSpan={5} className="py-1.5 px-3 text-[11px] font-bold text-gray-500">별도 잠금 · 승인 · 마스터</td></tr>
            <Toggle v={salary} set={setSalary} label="급여 정보 열람" hint="인사·총무 권한과 별개. 없으면 급여 칸이 가려짐" />
            <Toggle v={payment} set={setPayment} label="결제정보 열람" hint="상담일지 고객 결제정보. 없으면 본인 작성분만" />
            <Toggle v={approve} set={setApprove} label="승인권" hint="주문 수정 승인 · 휴가 승인 · 팀 업무 현황" />
            <Toggle v={isMaster} set={setIsMaster} label="마스터 계정" hint="전 영역 수정 + 권한 편집. 자기 자신은 해제 불가" />
          </tbody>
        </table>

        {canEdit && (
          <div className="px-5 py-3 border-t border-gray-100">
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="변경 사유 (선택)" className={`${inp} w-full`} />
          </div>
        )}

        <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-500 leading-relaxed">
          · 조회: 화면이 보이고 엑셀 다운로드도 되지만 저장·확정·삭제는 불가(서버도 거부). 없음: 메뉴·업무 선택에 나타나지 않고 주소로도 열리지 않음.<br />
          · 아르바이트: 신규 거래처·담당자 등록이 차단되며, 근무 종료일이 지나면 로그인 차단. 재고용 시 기간만 갱신.
        </div>

        <div className="px-5 py-3 border-t border-gray-100">
          <div className="text-xs font-semibold text-gray-600 mb-1.5">변경 이력</div>
          {logs.length === 0 ? <p className="text-xs text-gray-400">기록 없음 (초기값은 이력에 남지 않음)</p> : (
            <ul className="space-y-1">
              {logs.map(l => (
                <li key={l.id} className="text-[11px] text-gray-500">
                  {new Date(l.changed_at).toLocaleString('ko-KR')} · {changerName(l) ?? '?'}
                  {l.note ? ` — ${l.note}` : ''}
                  <span className="text-gray-300"> · </span>
                  {GROUP_KEYS.filter(k => (l.before_state.permissions as Permissions | undefined)?.[k] !== (l.after_state.permissions as Permissions | undefined)?.[k])
                    .map(k => `${GROUP_LABELS[k]} ${(l.before_state.permissions as Permissions | undefined)?.[k] ?? 'none'}→${(l.after_state.permissions as Permissions | undefined)?.[k] ?? 'none'}`).join(', ') || '기타 항목 변경'}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
