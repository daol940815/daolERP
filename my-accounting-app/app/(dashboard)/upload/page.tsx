'use client'

import { useCallback, useRef, useState } from 'react'
import { parseFile } from '@/lib/file-parser'
import type { ParseResult, UploadResult } from '@/types/upload'

// ── 타입 ────────────────────────────────────────────────────
type ItemStatus = 'parsing' | 'ready' | 'need_input' | 'uploading' | 'success' | 'duplicate' | 'error'

interface QueueItem {
  id: string
  file: File
  status: ItemStatus
  parseResult: ParseResult | null
  bankName: string
  accountNumber: string
  isMinusAccount: boolean
  error: string | null
  uploadResult: UploadResult | null
}

function uid() { return Math.random().toString(36).slice(2, 10) }

// ── 상태 배지 ────────────────────────────────────────────────
function StatusBadge({ item }: { item: QueueItem }) {
  switch (item.status) {
    case 'parsing':    return <span className="text-xs text-slate-400 whitespace-nowrap">분석 중…</span>
    case 'uploading':  return <span className="text-xs text-blue-500 whitespace-nowrap">업로드 중…</span>
    case 'need_input': return <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded-full whitespace-nowrap">은행명 필요</span>
    case 'duplicate':  return <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full whitespace-nowrap">중복 파일</span>
    case 'error':      return <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full whitespace-nowrap">오류</span>
    case 'success':    return (
      <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full whitespace-nowrap">
        완료 {item.uploadResult?.insertedRows.toLocaleString()}건
      </span>
    )
    case 'ready':      return <span className="px-2 py-0.5 text-xs bg-slate-100 text-slate-500 rounded-full whitespace-nowrap">대기</span>
  }
}

// ── 메인 페이지 ──────────────────────────────────────────────
export default function UploadPage() {
  const [queue, setQueue]             = useState<QueueItem[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging]   = useState(false)
  const [sourceType, setSourceType]   = useState<'bank' | 'card'>('bank')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const patchItem = useCallback((id: string, patch: Partial<QueueItem>) =>
    setQueue(q => q.map(item => item.id === id ? { ...item, ...patch } : item)), [])

  // ── 파싱 ───────────────────────────────────────────────────
  const parseItem = useCallback(async (id: string, file: File, srcType: 'bank' | 'card') => {
    try {
      const result = await parseFile(file, srcType)
      const fmt = result.detectedFormat ?? ''
      const detectedBank = (!fmt.includes('일반') && !fmt.includes('카드') && !fmt.includes('명세서') && fmt.length > 0)
        ? fmt : ''
      patchItem(id, {
        status: detectedBank ? 'ready' : 'need_input',
        parseResult: result,
        bankName: detectedBank,
        accountNumber: result.suggestedAccountNumber ?? '',
      })
    } catch (e) {
      patchItem(id, { status: 'error', error: e instanceof Error ? e.message : '파싱 실패' })
    }
  }, [patchItem])

  // ── 파일 추가 ───────────────────────────────────────────────
  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => /\.(csv|xlsx|xls)$/i.test(f.name))
    if (!arr.length) return
    const items: QueueItem[] = arr.map(file => ({
      id: uid(), file,
      status: 'parsing' as ItemStatus,
      parseResult: null,
      bankName: '', accountNumber: '',
      isMinusAccount: false, error: null, uploadResult: null,
    }))
    setQueue(q => [...q, ...items])
    items.forEach(item => parseItem(item.id, item.file, sourceType))
  }, [parseItem, sourceType])

  // ── 드래그 앤 드롭 ──────────────────────────────────────────
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files)
  }, [addFiles])
  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }
  const onDragLeave = () => setIsDragging(false)
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files); e.target.value = ''
  }

  // ── 업로드 ─────────────────────────────────────────────────
  const handleUploadAll = async () => {
    const targets = queue.filter(i => i.status === 'ready' || i.status === 'need_input')
    if (!targets.length) return
    setIsUploading(true)

    for (const item of targets) {
      if (!item.parseResult) continue
      patchItem(item.id, { status: 'uploading' })

      try {
        // 마이너스 통장: 업로드 직전 in/out 스왑
        const rows = item.isMinusAccount
          ? item.parseResult.rows.map(r => ({ ...r, amount_in: r.amount_out, amount_out: r.amount_in }))
          : item.parseResult.rows

        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rows,
            fileHash:       item.parseResult.fileHash,
            fileName:       item.parseResult.fileName,
            fileSize:       item.parseResult.fileSize,
            fileType:       item.parseResult.fileType,
            source:         sourceType,
            bankName:       item.bankName,
            accountNumber:  item.accountNumber,
            detectedFormat: item.parseResult.detectedFormat,
            isMinusAccount: item.isMinusAccount,
          }),
        })

        if (res.status === 409) {
          const data = await res.json()
          patchItem(item.id, { status: 'duplicate', error: data.message })
          continue
        }
        if (!res.ok) {
          const data = await res.json()
          patchItem(item.id, { status: 'error', error: data.error ?? '업로드 오류' })
          continue
        }
        const result: UploadResult = await res.json()
        patchItem(item.id, { status: 'success', uploadResult: result })
      } catch (e) {
        patchItem(item.id, { status: 'error', error: e instanceof Error ? e.message : '네트워크 오류' })
      }
    }

    setIsUploading(false)
  }

  // ── 파생 값 ────────────────────────────────────────────────
  const parsingCount    = queue.filter(i => i.status === 'parsing').length
  const uploadableCount = queue.filter(i => i.status === 'ready' || i.status === 'need_input').length
  const needInputCount  = queue.filter(i => i.status === 'need_input').length
  const doneCount       = queue.filter(i => ['success', 'duplicate', 'error'].includes(i.status)).length
  const allDone         = queue.length > 0 && queue.every(i => ['success', 'duplicate', 'error'].includes(i.status))
  const canUpload       = !isUploading && uploadableCount > 0 && parsingCount === 0

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">파일 업로드</h1>
      <p className="text-gray-500 text-sm mb-5">
        파일을 한 번에 여러 개 선택하거나 드래그해서 일괄 업로드하세요.
      </p>

      {/* 출처 선택 */}
      <div className="flex gap-2 mb-4">
        {(['bank', 'card'] as const).map(t => (
          <button key={t} onClick={() => setSourceType(t)} disabled={isUploading}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              sourceType === t
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-gray-600 border-gray-300 hover:border-slate-500'
            }`}
          >
            {t === 'bank' ? '🏦 은행 명세서' : '💳 카드 내역'}
          </button>
        ))}
      </div>

      {/* 드롭존 */}
      <div
        onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl text-center cursor-pointer transition-colors select-none mb-5 ${
          isDragging
            ? 'border-slate-700 bg-slate-50 py-12'
            : queue.length === 0
              ? 'py-20 border-gray-300 hover:border-slate-400 hover:bg-gray-50'
              : 'py-5 border-gray-200 hover:border-slate-400 hover:bg-gray-50'
        }`}
      >
        <div className={`${queue.length > 0 ? 'text-xl' : 'text-4xl'} mb-1.5`}>📂</div>
        <p className="text-gray-700 font-medium text-sm">
          {queue.length === 0 ? '파일을 드래그하거나 클릭해서 선택하세요' : '파일 추가 (드래그 또는 클릭)'}
        </p>
        <p className="text-gray-400 text-xs mt-0.5">CSV · XLSX · XLS · 다중 선택 가능</p>
      </div>
      <input ref={fileInputRef} type="file" multiple accept=".csv,.xlsx,.xls" onChange={onFileChange} className="hidden" />

      {/* 파일 큐 */}
      {queue.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-slate-700">
              파일 {queue.length}개
              {parsingCount > 0 && <span className="ml-2 text-slate-400 font-normal text-xs">{parsingCount}개 분석 중…</span>}
            </p>
            {!isUploading && !allDone && (
              <button onClick={() => setQueue([])} className="text-xs text-slate-400 hover:text-slate-700 transition-colors">
                전체 삭제
              </button>
            )}
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
            {queue.map(item => (
              <div key={item.id} className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 ${
                item.status === 'error'     ? 'bg-red-50' :
                item.status === 'success'   ? 'bg-green-50' :
                item.status === 'duplicate' ? 'bg-amber-50' : 'bg-white'
              }`}>

                {/* 파일명 + 건수 */}
                <div className="min-w-0 sm:w-48 shrink-0">
                  <p className="text-sm font-medium text-gray-800 truncate" title={item.file.name}>
                    {item.file.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {item.parseResult
                      ? `${item.parseResult.rows.length.toLocaleString()}건`
                      : `${(item.file.size / 1024).toFixed(1)} KB`}
                    {(item.parseResult?.warnings.length ?? 0) > 0 && (
                      <span className="ml-1 text-amber-500" title={item.parseResult!.warnings.join('\n')}>
                        ⚠{item.parseResult!.warnings.length}
                      </span>
                    )}
                  </p>
                  {(item.status === 'error' || item.status === 'duplicate') && item.error && (
                    <p className="text-xs text-red-500 mt-0.5 line-clamp-2">{item.error}</p>
                  )}
                </div>

                {/* 편집 필드 (ready / need_input / uploading) */}
                {['ready', 'need_input', 'uploading'].includes(item.status) && (
                  <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                    <input
                      type="text"
                      value={item.bankName}
                      onChange={e => patchItem(item.id, {
                        bankName: e.target.value,
                        status: e.target.value.trim() ? 'ready' : 'need_input',
                      })}
                      placeholder={sourceType === 'bank' ? '은행명 *' : '카드사명'}
                      disabled={item.status === 'uploading' || isUploading}
                      className={`w-28 text-sm border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-400 ${
                        !item.bankName.trim() ? 'border-orange-300 bg-orange-50' : 'border-gray-300'
                      }`}
                    />
                    {sourceType === 'bank' && (
                      <input
                        type="text"
                        value={item.accountNumber}
                        onChange={e => patchItem(item.id, { accountNumber: e.target.value })}
                        placeholder="계좌번호 (선택)"
                        disabled={item.status === 'uploading' || isUploading}
                        className="w-36 text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-400"
                      />
                    )}
                    {sourceType === 'bank' && (
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={item.isMinusAccount}
                          onChange={e => patchItem(item.id, { isMinusAccount: e.target.checked })}
                          disabled={item.status === 'uploading' || isUploading}
                          className="w-3.5 h-3.5 accent-amber-600"
                        />
                        <span className="text-xs text-gray-500 whitespace-nowrap">마이너스통장</span>
                      </label>
                    )}
                  </div>
                )}

                {/* 상태 + 삭제 */}
                <div className="flex items-center gap-2 sm:ml-auto shrink-0">
                  <StatusBadge item={item} />
                  {!isUploading && !['uploading', 'success'].includes(item.status) && (
                    <button
                      onClick={() => setQueue(q => q.filter(i => i.id !== item.id))}
                      className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-gray-500 transition-colors text-xs"
                      title="삭제"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 액션 바 */}
      {queue.length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm">
            {allDone ? (
              <span className="text-green-600 font-medium">
                업로드 완료 — 성공 {queue.filter(i => i.status === 'success').length}개
                {queue.filter(i => i.status === 'duplicate').length > 0 && ` · 중복 ${queue.filter(i => i.status === 'duplicate').length}개`}
                {queue.filter(i => i.status === 'error').length > 0 && ` · 오류 ${queue.filter(i => i.status === 'error').length}개`}
              </span>
            ) : needInputCount > 0 ? (
              <span className="text-orange-500 text-xs">⚠ 은행명 미입력 {needInputCount}개 — 입력 후 업로드하거나 그대로 진행 가능</span>
            ) : null}
          </div>

          <div className="flex gap-2 shrink-0">
            {allDone ? (
              <>
                <button
                  onClick={() => setQueue([])}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                >
                  초기화
                </button>
                <a
                  href="/transactions"
                  className="px-5 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700"
                >
                  거래 내역 보기 →
                </a>
              </>
            ) : (
              <>
                {!isUploading && (
                  <button
                    onClick={() => setQueue([])}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                  >
                    초기화
                  </button>
                )}
                <button
                  onClick={handleUploadAll}
                  disabled={!canUpload}
                  className="px-6 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isUploading
                    ? `업로드 중… (${doneCount}/${uploadableCount + doneCount})`
                    : `${uploadableCount}개 파일 업로드`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
