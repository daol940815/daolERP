'use client'

import { useCallback, useEffect, useState } from 'react'

// 직원·계정 관리 (관리자 전용)
// 직원을 등록하면서 로그인 계정을 함께 발급한다. 담당 배정용으로만 등록된
// 직원(계정 없음)도 여기서 정보를 채우고 계정을 붙일 수 있다.

interface Emp {
  id: string
  name: string
  team: string | null
  position: string | null
  phone: string | null
  email: string | null
  hire_date: string | null
  role: 'sales' | 'admin'
  is_active: boolean
  auth_user_id: string | null
}

const EMPTY = { name: '', team: '', position: '', phone: '', email: '', hire_date: '', role: 'sales', password: '' }

export default function EmployeesPage() {
  const [rows, setRows] = useState<Emp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)

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
    if (form.email && !form.password) { flash('계정을 발급하려면 비밀번호도 입력하세요.'); return }
    if (await post({ action: 'create', ...form })) {
      flash('직원 등록 완료' + (form.email ? ' (로그인 계정 발급됨)' : ''))
      setForm({ ...EMPTY }); setShowForm(false); load()
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">직원 · 계정 관리</h1>
      <p className="text-sm mt-1 text-gray-500">
        직원을 등록하면 로그인 계정이 함께 발급됩니다. 역할에 따라 접근 모드가 제한됩니다
        (영업 = 주문 관리만 · 관리자 = 전체). 여기 등록된 정보는 담당 배정과 추후 근태·직원 관리에 사용됩니다.
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
              ['email', '로그인 이메일', 'email'], ['password', '초기 비밀번호 (8자+)', 'text'],
            ] as const).map(([k, label, type]) => (
              <div key={k}>
                <label className="block text-[11px] text-gray-500 font-semibold mb-1">{label}</label>
                <input type={type} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              </div>
            ))}
            <div>
              <label className="block text-[11px] text-gray-500 font-semibold mb-1">역할</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                <option value="sales">영업 (주문 관리만)</option>
                <option value="admin">관리자 (전체)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-between items-center mt-3">
            <p className="text-[11px] text-gray-400">
              이메일·비밀번호를 비우면 담당 배정용 직원으로만 등록됩니다(로그인 불가, 나중에 계정 발급 가능).
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
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">이름</th>
                <th className="py-2 px-3 text-left font-medium">부서/직급</th>
                <th className="py-2 px-3 text-left font-medium">연락처</th>
                <th className="py-2 px-3 text-left font-medium">로그인 계정</th>
                <th className="py-2 px-3 text-left font-medium">역할</th>
                <th className="py-2 px-3 text-left font-medium">입사일</th>
                <th className="py-2 px-3 text-left font-medium">상태</th>
                <th className="py-2 px-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className={`border-b border-gray-50 ${r.is_active ? '' : 'opacity-45'}`}>
                  <td className="py-2 px-3 font-semibold">{r.name}</td>
                  <td className="py-2 px-3 text-gray-600">{[r.team, r.position].filter(Boolean).join(' · ') || '-'}</td>
                  <td className="py-2 px-3 text-gray-600">{r.phone ?? '-'}</td>
                  <td className="py-2 px-3">
                    {r.auth_user_id
                      ? <span className="text-gray-800">{r.email}</span>
                      : <span className="text-gray-300 text-xs">미발급 (담당 배정용)</span>}
                  </td>
                  <td className="py-2 px-3">
                    <select value={r.role} disabled={busy}
                      onChange={async e => { if (await post({ action: 'update', id: r.id, role: e.target.value })) { flash('역할 변경됨'); load() } }}
                      className="border border-gray-200 rounded px-1.5 py-0.5 text-xs">
                      <option value="sales">영업</option>
                      <option value="admin">관리자</option>
                    </select>
                  </td>
                  <td className="py-2 px-3 tabular-nums text-gray-500 text-xs">{r.hire_date ?? '-'}</td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {r.is_active ? '재직' : '퇴사/비활성'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button disabled={busy}
                      onClick={async () => {
                        const act = r.is_active ? 'deactivate' : 'reactivate'
                        if (r.is_active && !window.confirm(`${r.name} 님을 비활성화할까요? 로그인이 차단됩니다 (이력은 유지).`)) return
                        if (await post({ action: act, id: r.id })) { flash(r.is_active ? '비활성화됨 (로그인 차단)' : '재활성화됨'); load() }
                      }}
                      className={`text-xs px-2 py-1 border rounded ${r.is_active ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                      {r.is_active ? '비활성화' : '재활성화'}
                    </button>
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
