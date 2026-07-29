import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { transactionsApi, institutionsApi, accountsApi } from '@/lib/api'
import type { TransactionFilter } from '@/types'

export function useTransactions(filter: TransactionFilter) {
  return useQuery({
    queryKey: ['transactions', filter],
    queryFn: () => transactionsApi.getAll(filter),
    staleTime: 30_000,
  })
}

export function useTransaction(id: number) {
  return useQuery({
    queryKey: ['transaction', id],
    queryFn: () => transactionsApi.getById(id),
    enabled: !!id,
  })
}

export function useTransactionLogs(id: number) {
  return useQuery({
    queryKey: ['transaction', id, 'logs'],
    queryFn: () => transactionsApi.getLogs(id),
    enabled: !!id,
  })
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: { category?: string; memo?: string; counterparty?: string } }) =>
      transactionsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}

export function useInstitutions() {
  return useQuery({
    queryKey: ['institutions'],
    queryFn: institutionsApi.getAll,
    staleTime: 300_000,
  })
}

export function useAccounts(institutionId?: number) {
  return useQuery({
    queryKey: ['accounts', institutionId],
    queryFn: () => accountsApi.getAll(institutionId),
    staleTime: 300_000,
  })
}
