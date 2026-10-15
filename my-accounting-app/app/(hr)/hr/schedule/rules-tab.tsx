'use client'

import { useCallback, useEffect, useState } from 'react'
import { KIND_LABEL, RULE_CATEGORIES, type RuleCategory, type RuleRow } from '@/lib/schedule'

// 스케줄 관리 — ERP 원본에서 끌어올 수 없는 일정만 여기서 등록한다.
// 반복(매월·매년)은 규칙만 저장하고 캘린더가 그 달의 날짜를 계산한다.
// 휴일 처리 방향이 항목마다 다르다: 세무는 순연(next), 급여는 앞당김(prev).

type Row = RuleRow & { created_at?: string }
interface EmpOpt { id: string; name: string }

const SHIFT_LABEL: Record<string, string> = {
  prev: '앞당김 (직전 영업일)', next: '순연 (다음 영업일)', none: '그대로',
}
const KIND_TEXT: Record<string, string> = { monthly: '매월', yearly: '매년', once: '1회' }
const EMPTY = {
  id: '', title: '', category: 'other' as RuleCategory,
  repeat_kind: 'monthly', repeat_day: '', repeat_month: '',
  on_date: '', end_date: '', holiday_shift: 'next',
  amount: '', employee_id: '', finance_only: false, active: true, memo: '',
}
const won = (n: number) => n.toLocaleString('ko-KR')

export default function RulesTab() {
  const [rows, setRows] = useState<Row[]>([])
  const [emps, setEmps] = useState<EmpOpt[]>([])
  const [showMoney, setShowMoney] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [open, setOpen] = useState(false)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/schedule/rules')
    const json = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok) { setError(json.error ?? '조회 실패'); return }
    setError(null); setRows(json.rules); setShowMoney(!!json.showMoney); setCanEdit(!!json.can_edit)
  }, [])
  useEffect(() => { load() }, [load])

  // 외근·회의 대상 직원 선택용 — 스케줄 응답의 직원 목록이 없어 근태 API를 재사용한다
  useEffect(() => {
    fetch(`/api/attendance/records?month=${new Date().toISOString().slice(0, 7)}&scope=all`)
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.employees) setEmps(j.employees.filter((e: { is_active: boolean }) => e.is_active)) })
      .catch(() => null)
  }, [])

  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    const res = await fetch('/api/schedule/rules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(json.error ?? '실패'); return false }
    return true
  }

  const save = async () => {
    const body: Record<string, unknown> = {
      action: form.id ? 'update' : 'create', id: form.id || undefined,
      title: form.title, category: form.category, repeat_kind: form.repeat_kind,
      repeat_day: form.repeat_day, repeat_month: form.repeat_month,
      on_date: form.on_date, end_date: form.end_date,
      holiday_shift: form.holiday_shift, amount: form.amount,
      employee_id: form.employee_id, finance_only: form.finance_only,
      active: form.active, memo: form.memo,
    }
    if (await post(body)) {
      flash(form.id ? '수정되었습니다.' : '등록되었습니다.')
      setForm({ ...EMPTY }); setOpen(false); load()
    }
  }

  const edit = (r: Row) => {
    setForm({
      id: r.id, title: r.title, category: r.category,
      repeat_kind: r.repeat_kind, repeat_day: String(r.repeat_day ?? ''),
      repeat_month: String(r.repeat_month ?? ''), on_date: r.on_date ?? '',
      end_date: r.end_date ?? '', holiday_shift: r.holiday_shift,
      amount: r.amount ? String(r.amount) : '', employee_id: r.employee_id ?? '',
      finance_only: r.finance_only, active: r.active, memo: r.memo ?? '',
    })
    setOpen(true)
  }

  const toggleActive = async (r: Row) => {
    if (await post({
      action: 'update', id: r.id,
      title: r.title, category: r.category, repeat_kind: r.repeat_kind,
      repeat_day: r.repeat_day, repeat_month: r.repeat_month,
      on_date: r.on_date, end_date: r.end_date, holiday_shift: r.holiday_shift,
      amount: r.amount, employee_id: r.employee_id, finance_only: r.finance_only,
      memo: r.memo, active: !r.active,
    })) {
      flash(r.active ? '꺼졌습니다. 캘린더에 더 이상 표시되지 않습니다.' : '켜졌습니다.'); load()
    }
  }

  const remove = async (r: Row) => {
    if (!window.confirm(`'${r.title}' 규칙을 삭제할까요?\n캘린더에서 사라지며 되돌릴 수 없습니다.\n(잠시 숨기려면 삭제 대신 '끄기'를 쓰세요)`)) return
    if (await post({ action: 'delete', id: r.id })) { flash('삭제되었습니다.'); load() }
  }

  const when = (r: Row) => {
    if (r.repeat_kind === 'once') {
      return r.end_date && r.end_date !== r.on_date ? `${r.on_date} ~ ${r.end_date}` : (r.on_date ?? '-')
    }
    const d = r.repeat_day === 31 ? '말일' : `${r.repeat_day}일`
    return r.repeat_kind === 'yearly' ? `매년 ${r.repeat_month}월 ${d}` : `매월 ${d}`
  }

  const inp = 'w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm'
  const once = form.repeat_kind === 'once'

  return (
    <div>
      {msg && <div className="my-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="my-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      <div className="flex items-center gap-3 flex-wrap mb-3">
        <p className="text-xs text-gray-500">
          휴가 · 공휴일 · 아르바이트 · 대출은 여기 등록하지 않습니다 — 각자 원래 화면의 값이 캘린더에 자동으로 뜹니다.
          {!showMoney && ' 회계 전용 일정(세무·지급)은 권한이 없어 표시되지 않습니다.'}
        </p>
        {canEdit && (
          <button onClick={() => { setForm({ ...EMPTY }); setOpen(o => !o) }}
            className="ml-auto px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-700">
            {open ? '입력 닫기' : '+ 일정 등록'}
          </button>
        )}
      </div>

      {open && canEdit && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] text-gray-500 font-semibold mb-1">제목 *</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="예: 법인카드 대금 출금" className={inp} />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 font-semibold mb-1">구분</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as RuleCategory }))} className={inp}>
                {RULE_CATEGORIES.map(c => <option key={c} value={c}>{KIND_LABEL[c]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 font-semibold mb-1">반복</label>
              <select value={form.repeat_kind} onChange={e => setForm(f => ({ ...f, repeat_kind: e.target.value }))} className={inp}>
                <option value="monthly">매월</option>
                <option value="yearly">매년</option>
                <option value="once">1회 (외근·회의 등)</option>
              </select>
            </div>

            {once ? (<>
              <div>
                <label className="block text-[11px] text-gray-500 font-semibold mb-1">날짜 *</label>
                <input type="date" value={form.on_date} onChange={e => setForm(f => ({ ...f, on_date: e.target.value }))} className={inp} />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 font-semibold mb-1">종료일 (여러 날)</label>
                <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} className={inp} />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] text-gray-500 font-semibold mb-1">대상 직원 (선택)</label>
                <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} className={inp}>
                  <option value="">지정 안 함</option>
                  {emps.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            </>) : (<>
              {form.repeat_kind === 'yearly' && (
                <div>
                  <label className="block text-[11px] text-gray-500 font-semibold mb-1">월 *</label>
                  <input type="number" min={1} max={12} value={form.repeat_month}
                    onChange={e => setForm(f => ({ ...f, repeat_month: e.target.value }))} className={inp} />
                </div>
              )}
              <div>
                <label className="block text-[11px] text-gray-500 font-semibold mb-1">일자 * <span className="text-gray-400 font-normal">31 = 말일</span></label>
                <input type="number" min={1} max={31} value={form.repeat_day}
                  onChange={e => setForm(f => ({ ...f, repeat_day: e.target.value }))} className={inp} />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 font-semibold mb-1">휴일이면</label>
                <select value={form.holiday_shift} onChange={e => setForm(f => ({ ...f, holiday_shift: e.target.value }))} className={inp}>
                  <option value="next">순연 (다음 영업일) — 세무·자동이체</option>
                  <option value="prev">앞당김 (직전 영업일) — 급여</option>
                  <option value="none">그대로</option>
                </select>
              </div>
            </>)}

            <div>
              <label className="block text-[11px] text-gray-500 font-semibold mb-1">예상 금액 (선택)</label>
              <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className={inp} />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] text-gray-500 font-semibold mb-1">메모 (선택)</label>
              <input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} className={inp} />
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3 flex-wrap">
            {showMoney && (
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={form.finance_only}
                  onChange={e => setForm(f => ({ ...f, finance_only: e.target.checked }))} />
                회계 권한자에게만 보이기 (세무·지급 금액)
              </label>
            )}
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={form.active}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
              캘린더에 표시
            </label>
            <button onClick={save} disabled={busy}
              className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {form.id ? '수정' : '등록'}
            </button>
            {form.id && (
              <button onClick={() => { setForm({ ...EMPTY }); setOpen(false) }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm">취소</button>
            )}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        {loading ? <div className="text-center py-16 text-gray-400">로딩 중...</div> : (
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">제목</th>
                <th className="py-2 px-3 text-left font-medium">구분</th>
                <th className="py-2 px-3 text-left font-medium">주기</th>
                <th className="py-2 px-3 text-left font-medium">휴일이면</th>
                <th className="py-2 px-3 text-right font-medium">금액</th>
                <th className="py-2 px-3 text-left font-medium">비고</th>
                <th className="py-2 px-3 text-right font-medium w-44"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className={`border-b border-gray-50 ${r.active ? '' : 'opacity-45'}`}>
                  <td className="py-2 px-3 font-semibold">
                    {r.title}
                    {r.finance_only && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-slate-100 text-slate-500">회계 전용</span>}
                  </td>
                  <td className="py-2 px-3 text-gray-600">{KIND_LABEL[r.category]}</td>
                  <td className="py-2 px-3 text-gray-600">
                    <span className="text-[11px] text-gray-400 mr-1">{KIND_TEXT[r.repeat_kind]}</span>{when(r)}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-500">
                    {r.repeat_kind === 'once' ? '-' : SHIFT_LABEL[r.holiday_shift]}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.amount ? won(r.amount) : <span className="text-gray-300">-</span>}</td>
                  <td className="py-2 px-3 text-xs text-gray-400">{r.memo ?? ''}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {canEdit && (<>
                      <button onClick={() => edit(r)} className="text-xs px-2 py-1 border border-gray-300 rounded mr-1 hover:bg-gray-50">수정</button>
                      <button onClick={() => toggleActive(r)} disabled={busy}
                        className="text-xs px-2 py-1 border border-gray-300 rounded mr-1 hover:bg-gray-50">
                        {r.active ? '끄기' : '켜기'}
                      </button>
                      <button onClick={() => remove(r)} disabled={busy}
                        className="text-xs px-2 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50">삭제</button>
                    </>)}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">
                  등록된 일정이 없습니다. 202 마이그레이션을 실행하면 세무 마감과 급여일이 들어옵니다.
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
