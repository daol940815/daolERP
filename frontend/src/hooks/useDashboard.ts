import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from '@/lib/api'

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: dashboardApi.getStats,
    staleTime: 60_000,
  })
}

export function useMonthlyData(year?: number) {
  return useQuery({
    queryKey: ['dashboard', 'monthly', year],
    queryFn: () => dashboardApi.getMonthly(year),
    staleTime: 60_000,
  })
}

export function useInstitutionSummary() {
  return useQuery({
    queryKey: ['dashboard', 'by-institution'],
    queryFn: dashboardApi.getByInstitution,
    staleTime: 60_000,
  })
}
