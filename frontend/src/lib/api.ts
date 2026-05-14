import axios from 'axios'
import type {
  Institution,
  Account,
  Transaction,
  TransactionLog,
  UploadHistory,
  UploadResult,
  DashboardStats,
  MonthlySummary,
  InstitutionSummary,
  PaginatedResponse,
  TransactionFilter,
} from '@/types'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// Institutions
export const institutionsApi = {
  getAll: () => api.get<Institution[]>('/institutions/').then(r => r.data),
  getById: (id: number) => api.get<Institution>(`/institutions/${id}`).then(r => r.data),
}

// Accounts
export const accountsApi = {
  getAll: (institutionId?: number) =>
    api.get<Account[]>('/accounts/', { params: { institution_id: institutionId } }).then(r => r.data),
  getById: (id: number) => api.get<Account>(`/accounts/${id}`).then(r => r.data),
  create: (data: Partial<Account>) => api.post<Account>('/accounts/', data).then(r => r.data),
}

// Transactions
export const transactionsApi = {
  getAll: (filter: TransactionFilter = {}) =>
    api.get<PaginatedResponse<Transaction>>('/transactions/', { params: filter }).then(r => r.data),
  getById: (id: number) => api.get<Transaction>(`/transactions/${id}`).then(r => r.data),
  update: (id: number, data: { category?: string; memo?: string; counterparty?: string }) =>
    api.patch<Transaction>(`/transactions/${id}`, data).then(r => r.data),
  getLogs: (id: number) =>
    api.get<TransactionLog[]>(`/transactions/${id}/logs`).then(r => r.data),
}

// Upload
export const uploadApi = {
  uploadFile: (file: File, institutionId: number, accountId: number) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('institution_id', String(institutionId))
    formData.append('account_id', String(accountId))
    return api.post<UploadResult>('/upload/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
  getHistory: (institutionId?: number, limit = 50) =>
    api.get<UploadHistory[]>('/upload/history', {
      params: { institution_id: institutionId, limit },
    }).then(r => r.data),
}

// Dashboard
export const dashboardApi = {
  getStats: () => api.get<DashboardStats>('/dashboard/stats').then(r => r.data),
  getMonthly: (year?: number) =>
    api.get<MonthlySummary[]>('/dashboard/monthly', { params: { year } }).then(r => r.data),
  getByInstitution: () =>
    api.get<InstitutionSummary[]>('/dashboard/by-institution').then(r => r.data),
}

export default api
