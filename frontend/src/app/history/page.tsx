'use client'

import { useQuery } from '@tanstack/react-query'
import MainLayout from '@/components/layout/MainLayout'
import { uploadApi } from '@/lib/api'
import { CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'

const STATUS_CONFIG = {
  completed: { label: '완료', icon: CheckCircle, cls: 'text-emerald-400' },
  failed: { label: '실패', icon: XCircle, cls: 'text-red-400' },
  processing: { label: '처리중', icon: Loader2, cls: 'text-yellow-400 animate-spin' },
  pending: { label: '대기', icon: Clock, cls: 'text-slate-400' },
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function HistoryPage() {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['upload-history'],
    queryFn: () => uploadApi.getHistory(undefined, 100),
    staleTime: 30_000,
  })

  return (
    <MainLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-slate-200">업로드 이력</h1>
          <span className="text-sm text-slate-500">총 {history.length}건</span>
        </div>

        <div className="erp-card overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> 불러오는 중...
            </div>
          ) : history.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-500">
              업로드 이력이 없습니다
            </div>
          ) : (
            <table className="erp-table">
              <thead>
                <tr>
                  <th>업로드 일시</th>
                  <th>파일명</th>
                  <th>기관</th>
                  <th>크기</th>
                  <th className="text-right">전체</th>
                  <th className="text-right">성공</th>
                  <th className="text-right">중복</th>
                  <th className="text-right">오류</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => {
                  const status = STATUS_CONFIG[h.status] || STATUS_CONFIG.pending
                  const StatusIcon = status.icon

                  return (
                    <tr key={h.id}>
                      <td className="text-slate-400 text-xs">
                        {new Date(h.uploaded_at).toLocaleString('ko-KR')}
                      </td>
                      <td className="max-w-[200px] truncate text-slate-200" title={h.filename}>
                        {h.filename}
                      </td>
                      <td className="text-slate-300 text-xs">
                        {h.institution?.name ?? '-'}
                      </td>
                      <td className="text-slate-400 text-xs">
                        {formatFileSize(h.file_size)}
                      </td>
                      <td className="text-right text-slate-300">{h.total_rows}</td>
                      <td className="text-right text-emerald-400">{h.success_rows}</td>
                      <td className="text-right text-yellow-400">{h.duplicate_rows}</td>
                      <td className="text-right text-red-400">{h.error_rows}</td>
                      <td>
                        <div className={clsx('flex items-center gap-1 text-xs', status.cls)}>
                          <StatusIcon className="w-3.5 h-3.5" />
                          {status.label}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </MainLayout>
  )
}
