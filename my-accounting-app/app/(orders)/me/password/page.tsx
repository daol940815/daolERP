'use client'

// 내 비밀번호 변경 — 본인 계정만, 권한 불필요 (2026-10-01 사용자 요청).
// 현재 비밀번호로 다시 로그인해 본인 확인 → 새 비밀번호로 갱신. 모두 로그인한 브라우저 세션의 권한으로만 하며
// 서비스 키·관리자 API를 쓰지 않는다. 관리자 재설정(직원·계정·권한 화면, 인사·총무 수정 권한)은 그대로 둔다.
// 비밀번호는 어디에도 저장하지 않는다 (CLAUDE.md 로그인 유지 정책).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const MIN_LEN = 6

export default function MyPasswordPage() {
  const router = useRouter()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (next.length < MIN_LEN) { setError(`새 비밀번호는 ${MIN_LEN}자 이상이어야 합니다.`); return }
    if (next !== confirm) { setError('새 비밀번호와 확인 입력이 서로 다릅니다.'); return }
    if (next === current) { setError('현재 비밀번호와 다른 비밀번호를 입력하세요.'); return }
    setBusy(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) { setBusy(false); setError('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.'); return }

    // 본인 확인 — 현재 비밀번호로 재인증 (세션 쿠키는 sessionOnly 경로로 갱신됨)
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
    if (updErr) {
      setError(/password/i.test(updErr.message) ? `비밀번호 규칙에 맞지 않습니다 (${MIN_LEN}자 이상). ${updErr.message}` : `변경 실패: ${updErr.message}`)
      return
    }
    setDone(true)
    setCurrent(''); setNext(''); setConfirm('')
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900'

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">비밀번호 변경</h1>
      <p className="text-sm mt-1 text-gray-500">본인 계정의 비밀번호를 바꿉니다. 현재 비밀번호로 본인 확인을 먼저 합니다.</p>

      {done ? (
        <div className="mt-6 bg-white border border-gray-200 rounded-xl p-6">
          <p className="text-sm text-green-700 font-medium">비밀번호가 변경되었습니다.</p>
          <p className="text-xs text-gray-500 mt-1">다음 로그인부터 새 비밀번호를 사용하세요. 지금 세션은 그대로 유지됩니다.</p>
          <div className="flex gap-2 mt-4">
            <button onClick={() => router.back()} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700">돌아가기</button>
            <button onClick={() => setDone(false)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">다시 변경</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}
          <label className="block">
            <span className="text-xs font-medium text-gray-600">현재 비밀번호</span>
            <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required className={`${inputCls} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">새 비밀번호 ({MIN_LEN}자 이상)</span>
            <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} required minLength={MIN_LEN} className={`${inputCls} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">새 비밀번호 확인</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={MIN_LEN} className={`${inputCls} mt-1`} />
          </label>
          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
              {busy ? '변경 중...' : '비밀번호 변경'}
            </button>
            <button type="button" onClick={() => router.back()} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">취소</button>
          </div>
          <p className="text-xs text-gray-400">비밀번호를 잊었으면 인사·총무 담당자(직원·계정·권한 화면)에게 재설정을 요청하세요.</p>
        </form>
      )}
    </div>
  )
}
