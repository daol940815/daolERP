'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function LogoutButton() {
  const router = useRouter()
  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }
  return (
    <button
      onClick={handleLogout}
      className="text-xs text-slate-500 hover:text-white border border-slate-700 rounded-lg px-3 py-1.5 transition-colors"
    >
      로그아웃
    </button>
  )
}
