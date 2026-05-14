'use client'

import { Menu, Moon, Sun, RefreshCw } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { useQueryClient } from '@tanstack/react-query'

export default function Header() {
  const { sidebarOpen, setSidebarOpen, darkMode, toggleDarkMode } = useStore()
  const queryClient = useQueryClient()

  return (
    <header className="h-12 flex-shrink-0 border-b border-[#2e3a4e] bg-[#161d2e] flex items-center px-4 gap-3">
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
        title="사이드바 토글"
      >
        <Menu className="w-4 h-4" />
      </button>

      <div className="flex-1" />

      <button
        onClick={() => queryClient.invalidateQueries()}
        className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
        title="새로고침"
      >
        <RefreshCw className="w-4 h-4" />
      </button>

      <button
        onClick={toggleDarkMode}
        className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
        title="테마 변경"
      >
        {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      <div className="text-xs text-slate-500 pl-2 border-l border-slate-700">
        FinBook v1.0
      </div>
    </header>
  )
}
