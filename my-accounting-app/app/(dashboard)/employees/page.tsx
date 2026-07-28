'use client'

import { useCallback, useEffect, useState } from 'react'

// 직원·계정 관리 (전체 관리자 전용)
// 직원 등록 시 로그인 계정(ID 방식)을 함께 발급한다. 목록에서 수정·삭제·비번 재설정 가능.

interface Emp {
  id: string
  name: string
  team: string | null
  position: string | null
  phone: string | null
  hire_date: string | null
  role: 'sales' | 'manager' | 'admin'
  is_active: boolean
  auth_user_id: string | null
  login_id: string | null
}

const ROLE_LABEL: Record<string, string> = {
  sales: '직원', manager: '중간 관리자', admin: '전체 관리자',
}
const EMPTY = { name: '', team: '', position: '', phone: '', hire_date: '', role: 'sales', login_id: '', password: '' }

export default function EmployeesPage() {
  const [rows, setRows] = useState<Emp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ name: '', team: '', position: '', phone: '', hire_date: '', login_id: '' })

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const res = await fetch('/api/employees')
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '조회 실패')
    else setRows(json.employees)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (body: Record<string, string>) => {
    setBusy(true)
    const res = await fetch('/api/employees', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(json.error ?? '실패'); return false }
    return true
  }

  const create = async () => {
    if (!form.name.trim()) { flash('이름을 입력하세요.'); return }
    if (form.login_id && !form.password) { flash('계정을 발급하려면 비밀번호도 입력하세요.'); return }
    if (await post({ action: 'create', ...form })) {
      flash('직원 등록 완료' + (form.login_id ? ' (로그인 계정 발급됨)' : ''))
      setForm({ ...EMPTY }); setShowForm(false); load()
    }
  }

  const startEdit = (r: Emp) => {
    setEditId(r.id)
    setEdit({
      name: r.name, team: r.team ?? '', position: r.position ?? '',
      phone: r.phone ?? '', hire_date: r.hire_date ?? '', login_id: r.login_id ?? '',
    })
  }
  const saveEdit = async () => {
    if (!editId) return
    if (await post({ action: 'update', id: editId, ...edit })) {
      flash('수정 완료'); setEditId(null); load()
    }
  }

  const resetPassword = async (r: Emp) => {
    const pw = window.prompt(`${r.name} 님의 새 비밀번호를 입력하세요:`)
    if (!pw) return
    if (await post({ action: 'set_password', id: r.id, password: pw })) flash('비밀번호가 재설정되었습니다.')
  }

  const remove = async (r: Emp) => {
    if (!window.confirm(`${r.name} 님을 완전히 삭제할까요?\n로그인 계정과 거래처 담당 배정이 함께 삭제되며 되돌릴 수 없습니다.\n(퇴사 처리는 삭제 대신 '비활성화'를 권장합니다)`)) return
    if (await post({ action: 'delete', id: r.id })) { flash('삭제되었습니다.'); load() }
  }

  const inp = 'w-full border border-gray-300 rounded px-2 py-1 text-xs'

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">직원 · 계정 관리</h1>
      <p className="text-sm mt-1 text-gray-500">
        직원 등록 시 로그인 계정(ID 방식)이 함께 발급됩니다. 등급: 직원(주문 관리) ·
        중간 관리자(주문 관리 + 수정·승인 권한, 회계 접근 불가) · 전체 관리자(전체 접근).
      </p>

      {msg && <div className="my-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="my-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      <div className="flex justify-end my-4">
        <button onClick={() => setShowForm(s => !s)}
          className="px-3.5 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700">
          {showForm ? '입력 닫기' : '+ 직원 등록'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {([
              ['name', '이름 *', 'text'], ['team', '부서/팀', 'text'], ['position', '직급', 'text'],
              ['phone', '연락처', 'text'], ['hire_date', '입사일', 'date'],
              ['login_id', '로그인 ID (영문·숫자)', 'text'], ['password', '초기 비밀번호', 'text'],
            ] as const).map(([k, label, type]) => (
              <div key={k}>
                <label className="block text-[11px] text-gray-500 font-semibold mb-1">{label}</label>
                <input type={type} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
            ))}
            <div>
              <label className="block text-[11px] text-gray-500 font-semibold mb-1">등급</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                <option value="sales">직원 (주문 관리)</option>
                <option value="manager">중간 관리자 (주문 관리 + 승인)</option>
                <option value="admin">전체 관리자</option>
              </select>
            </div>
          </div>
          <div className="flex justify-between items-center mt-3">
            <p className="text-[11px] text-gray-400">
              ID를 비우면 담당 배정용 직원으로만 등록됩니다(로그인 불가, 나중에 발급 가능).
              비밀번호는 인증 서버 최소 기준(6자)만 넘으면 됩니다.
            </p>
            <button onClick={create} disabled={busy}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              등록
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        {loading ? <div className="text-center py-16 text-gray-400">로딩 중...</div> : (
          <table className="w-full text-sm min-w-[880px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">이름</th>
                <th className="py-2 px-3 text-left font-medium">부서/직급</th>
                <th className="py-2 px-3 text-left font-medium">연락처</th>
                <th className="py-2 px-3 text-left font-medium">로그인 ID</th>
                <th className="py-2 px-3 text-left font-medium">등급</th>
                <th className="py-2 px-3 text-left font-medium">입사일</th>
                <th className="py-2 px-3 text-left font-medium">상태</th>
                <th className="py-2 px-3 text-right font-medium w-56"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => editId === r.id ? (
                <tr key={r.id} className="border-b border-gray-50 bg-blue-50/40">
                  <td className="py-2 px-3"><input value={edit.name} onChange={e => setEdit(s => ({ ...s, name: e.target.value }))} className={inp} /></td>
                  <td className="py-2 px-3">
                    <div className="flex gap-1">
                      <input value={edit.team} onChange={e => setEdit(s => ({ ...s, team: e.target.value }))} placeholder="부서" className={inp} />
                      <input value={edit.position} onChange={e => setEdit(s => ({ ...s, position: e.target.value }))} placeholder="직급" className={inp} />
                    </div>
                  </td>
                  <td className="py-2 px-3"><input value={edit.phone} onChange={e => setEdit(s => ({ ...s, phone: e.target.value }))} className={inp} /></td>
                  <td className="py-2 px-3"><input value={edit.login_id} onChange={e => setEdit(s => ({ ...s, login_id: e.target.value }))} className={inp} /></td>
                  <td className="py-2 px-3 text-xs text-gray-400">{ROLE_LABEL[r.role]}</td>
                  <td className="py-2 px-3"><input type="date" value={edit.hire_date} onChange={e => setEdit(s => ({ ...s, hire_date: e.target.value }))} className={inp} /></td>
                  <td className="py-2 px-3"></td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    <button onClick={saveEdit} disabled={busy} className="text-xs px-2 py-1 bg-slate-900 text-white rounded mr-1">저장</button>
                    <button onClick={() => setEditId(null)} className="text-xs px-2 py-1 border border-gray-300 rounded">취소</button>
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className={`border-b border-gray-50 ${r.is_active ? '' : 'opacity-45'}`}>
                  <td className="py-2 px-3 font-semibold">{r.name}</td>
                  <td className="py-2 px-3 text-gray-600">{[r.team, r.position].filter(Boolean).join(' · ') || '-'}</td>
                  <td className="py-2 px-3 text-gray-600">{r.phone ?? '-'}</td>
                  <td className="py-2 px-3">
                    {r.login_id
                      ? <span className="text-gray-800 font-mono text-xs">{r.login_id}</span>
                      : <span className="text-gray-300 text-xs">미발급</span>}
                  </td>
                  <td className="py-2 px-3">
                    <select value={r.role} disabled={busy}
                      onChange={async e => { if (await post({ action: 'update', id: r.id, role: e.target.value })) { flash('등급 변경됨'); load() } }}
                      className="border border-gray-200 rounded px-1.5 py-0.5 text-xs">
                      <option value="sales">직원</option>
                      <option value="manager">중간 관리자</option>
                      <option value="admin">전체 관리자</option>
                    </select>
                  </td>
                  <td className="py-2 px-3 tabular-nums text-gray-500 text-xs">{r.hire_date ?? '-'}</td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {r.is_active ? '재직' : '비활성'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(r)} className="text-xs px-2 py-1 border border-gray-300 rounded mr-1 hover:bg-gray-50">수정</button>
                    {r.auth_user_id && (
                      <button onClick={() => resetPassword(r)} disabled={busy}
                        className="text-xs px-2 py-1 border border-gray-300 rounded mr-1 hover:bg-gray-50">비번</button>
                    )}
                    <button disabled={busy}
                      onClick={async () => {
                        const act = r.is_active ? 'deactivate' : 'reactivate'
                        if (r.is_active && !window.confirm(`${r.name} 님을 비활성화할까요? 로그인이 차단됩니다 (이력 유지).`)) return
                        if (await post({ action: act, id: r.id })) { flash(r.is_active ? '비활성화됨' : '재활성화됨'); load() }
                      }}
                      className="text-xs px-2 py-1 border border-gray-300 rounded mr-1 hover:bg-gray-50">
                      {r.is_active ? '비활성화' : '재활성화'}
                    </button>
                    <button onClick={() => remove(r)} disabled={busy}
                      className="text-xs px-2 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50">삭제</button>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="text-center py-12 text-gray-400 text-sm">등록된 직원이 없습니다.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
