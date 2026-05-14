'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import DropZone from './DropZone'
import { uploadApi, accountsApi } from '@/lib/api'
import { useInstitutions } from '@/hooks/useTransactions'
import { useQuery } from '@tanstack/react-query'
import type { UploadResult } from '@/types'

export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null)
  const [institutionId, setInstitutionId] = useState<number | ''>('')
  const [accountId, setAccountId] = useState<number | ''>('')
  const [result, setResult] = useState<UploadResult | null>(null)

  const { data: institutions = [] } = useInstitutions()
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', institutionId],
    queryFn: () => accountsApi.getAll(institutionId as number),
    enabled: !!institutionId,
  })

  const queryClient = useQueryClient()

  const uploadMutation = useMutation({
    mutationFn: () => uploadApi.uploadFile(file!, institutionId as number, accountId as number),
    onSuccess: (data) => {
      setResult(data)
      setFile(null)
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })

  const canSubmit = file && institutionId && accountId && !uploadMutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (canSubmit) uploadMutation.mutate()
  }

  const handleReset = () => {
    setResult(null)
    setFile(null)
    setInstitutionId('')
    setAccountId('')
    uploadMutation.reset()
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {result ? (
        // 업로드 결과
        <div className="erp-card p-6 space-y-4">
          <div className="flex items-center gap-3">
            {result.status === 'completed' ? (
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            ) : (
              <AlertCircle className="w-8 h-8 text-red-400" />
            )}
            <div>
              <div className="text-lg font-semibold text-slate-200">
                {result.status === 'completed' ? '업로드 완료' : '업로드 실패'}
              </div>
              <div className="text-sm text-slate-500">{result.filename}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: '전체 행수', value: result.total_rows, color: 'text-slate-200' },
              { label: '처리 성공', value: result.success_rows, color: 'text-emerald-400' },
              { label: '중복 제외', value: result.duplicate_rows, color: 'text-yellow-400' },
              { label: '오류', value: result.error_rows, color: 'text-red-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-slate-800/50 rounded-lg p-3">
                <div className="text-xs text-slate-500">{label}</div>
                <div className={clsx('text-2xl font-bold mt-1', color)}>{value}</div>
              </div>
            ))}
          </div>

          {result.errors.length > 0 && (
            <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-3">
              <div className="text-xs text-red-400 font-medium mb-1">오류 내용</div>
              {result.errors.slice(0, 5).map((err, i) => (
                <div key={i} className="text-xs text-red-300">{err}</div>
              ))}
            </div>
          )}

          <button onClick={handleReset} className="btn-primary w-full">
            새 파일 업로드
          </button>
        </div>
      ) : (
        // 업로드 폼
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="erp-card p-4 space-y-4">
            <h2 className="text-sm font-semibold text-slate-200">거래내역 업로드</h2>

            {/* 기관/계좌 선택 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">금융기관 *</label>
                <select
                  value={institutionId}
                  onChange={e => {
                    setInstitutionId(e.target.value ? Number(e.target.value) : '')
                    setAccountId('')
                  }}
                  className="erp-input w-full"
                  required
                >
                  <option value="">선택하세요</option>
                  {institutions.map(i => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">계좌 *</label>
                <select
                  value={accountId}
                  onChange={e => setAccountId(e.target.value ? Number(e.target.value) : '')}
                  className="erp-input w-full"
                  required
                  disabled={!institutionId}
                >
                  <option value="">
                    {!institutionId ? '기관 먼저 선택' : accounts.length === 0 ? '계좌 없음' : '선택하세요'}
                  </option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.account_name || a.account_number || `계좌 #${a.id}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 드롭존 */}
            <DropZone file={file} onFileSelect={setFile} />

            {/* 에러 */}
            {uploadMutation.isError && (
              <div className="text-red-400 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                업로드 중 오류가 발생했습니다
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className={clsx(
              'w-full py-3 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors',
              canSubmit
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            )}
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                업로드 중...
              </>
            ) : (
              '업로드 시작'
            )}
          </button>
        </form>
      )}
    </div>
  )
}
