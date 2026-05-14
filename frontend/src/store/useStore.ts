import { create } from 'zustand'
import type { Institution, Account, TransactionFilter } from '@/types'

interface AppState {
  // 사이드바
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void

  // 선택된 기관/계좌
  selectedInstitution: Institution | null
  setSelectedInstitution: (institution: Institution | null) => void
  selectedAccount: Account | null
  setSelectedAccount: (account: Account | null) => void

  // 거래내역 필터
  transactionFilter: TransactionFilter
  setTransactionFilter: (filter: Partial<TransactionFilter>) => void
  resetTransactionFilter: () => void

  // 다크모드
  darkMode: boolean
  toggleDarkMode: () => void
}

const defaultFilter: TransactionFilter = {
  page: 1,
  size: 50,
}

export const useStore = create<AppState>((set) => ({
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  selectedInstitution: null,
  setSelectedInstitution: (institution) =>
    set({ selectedInstitution: institution, selectedAccount: null }),

  selectedAccount: null,
  setSelectedAccount: (account) => set({ selectedAccount: account }),

  transactionFilter: defaultFilter,
  setTransactionFilter: (filter) =>
    set((state) => ({
      transactionFilter: { ...state.transactionFilter, ...filter, page: 1 },
    })),
  resetTransactionFilter: () => set({ transactionFilter: defaultFilter }),

  darkMode: true,
  toggleDarkMode: () =>
    set((state) => {
      const next = !state.darkMode
      if (next) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
      return { darkMode: next }
    }),
}))
