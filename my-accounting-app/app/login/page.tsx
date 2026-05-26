'use client'

// 로그인 페이지는 인증 상태를 확인하므로 항상 동적으로 렌더링
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      // Supabase 영문 오류를 한국어로 변환
      if (authError.message.includes('Invalid login credentials')) {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.')
      } else if (authError.message.includes('Email not confirmed')) {
        setError('이메일 인증이 완료되지 않았습니다. 메일함을 확인해 주세요.')
      } else if (authError.message.includes('Too many requests')) {
        setError('로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.')
      } else {
        setError('로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      }
      setLoading(false)
      return
    }

    // 로그인 성공 시 대시보드로 이동
    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* 로고/타이틀 영역 */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900">daolERP</h1>
          <p className="text-slate-500 text-sm mt-1">회계 관리 시스템</p>
        </div>

        {/* 로그인 카드 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-6">로그인</h2>

          <form onSubmit={handleLogin} className="space-y-5">
            {/* 이메일 입력 */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                이메일
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@company.com"
                required
                disabled={loading}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent
                           disabled:bg-slate-50 disabled:text-slate-400
                           placeholder:text-slate-400"
              />
            </div>

            {/* 비밀번호 입력 */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                비밀번호
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호를 입력하세요"
                required
                disabled={loading}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent
                           disabled:bg-slate-50 disabled:text-slate-400
                           placeholder:text-slate-400"
              />
            </div>

            {/* 오류 메시지 */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* 로그인 버튼 */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 text-white py-2.5 px-4 rounded-lg text-sm font-medium
                         hover:bg-slate-700 transition-colors
                         disabled:bg-slate-400 disabled:cursor-not-allowed
                         focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          © 2024 daolERP. All rights reserved.
        </p>
      </div>
    </div>
  )
}
