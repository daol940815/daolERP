'use client'

import { useCallback, useRef, useState } from 'react'
import { parseFile } from '@/lib/file-parser'
import type { AccountPreview, ParseResult, ParsedRow, UploadResult } from '@/types/upload'

// ── 타입 ────────────────────────────────────────────────────
type ItemStatus = 'parsing' | 'ready' | 'need_input' | 'uploading' | 'success' | 'duplicate' | 'error'

// 업로드 대상: 은행 명세서(클라이언트 파싱→/api/upload) /
// 카드매출·법인카드 사용내역(파일 그대로 각 import API가 서버에서 파싱)
type UploadSource = 'bank' | 'card_sales' | 'card_expenses'

const SOURCE_META: Record<UploadSource, { label: string; hint: string; doneHref: string; doneLabel: string }> = {
  bank:          { label: '은행 명세서',        hint: '은행에서 내려받은 입출금 명세서 (CSV·XLSX·XLS)',            doneHref: '/transactions',  doneLabel: '거래 내역 보기 →' },
  card_sales:    { label: '카드매출',           hint: '카드 매출 상세내역 — 단말기결제·수기결제(PG) 다운로드 파일', doneHref: '/cards',    doneLabel: '카드매출 보기 →' },
  card_expenses: { label: '법인카드 사용내역',  hint: '카드사 이용내역 — 여러 카드사 시트 합본 지원',               doneHref: '/cards?tab=expenses', doneLabel: '법인카드 보기 →' },
}

interface QueueItem {
  id: string
  file: File
  source: UploadSource
  status: ItemStatus
  parseResult: ParseResult | null   // 은행만 사용 (클라이언트 파싱)
  bankName: string                  // 은행만 사용
  accountNumber: string             // 은행만 사용
  error: string | null
  uploadResult: UploadResult | null // 은행 결과
  resultText: string | null         // 카드 결과 요약
  // ── 통합계좌(멀티뱅킹) 파일 전용 ──
  previews: AccountPreview[] | null // 계좌별 DB 등록 여부·기존 마지막 거래일
  skipExisting: boolean             // 기존 마지막 거래일 이후만 올리기 (기본 켬)
  excluded: string[]                // 업로드에서 뺀 계좌 (digits)
}

function uid() { return Math.random().toString(36).slice(2, 10) }

const digitsOf = (v: string | null | undefined) => String(v ?? '').replace(/[^0-9]/g, '')

// 통합계좌 파일에서 실제로 올릴 행만 고른다.
//  · 제외한 계좌는 빼고
//  · '기존 마지막 거래일 이후만'이 켜져 있으면 그 날짜 이후 거래만
// 단일 계좌 파일은 전체를 그대로 올린다.
function selectedRows(item: QueueItem): ParsedRow[] {
  const all = item.parseResult?.rows ?? []
  if (!isMultiAccount(item)) return all
  const lastByDigits = new Map<string, string | null>()
  for (const p of item.previews ?? []) lastByDigits.set(p.digits, p.last_tx_date)
  return all.filter(r => {
    const d = digitsOf(r.account_number)
    if (!d || item.excluded.includes(d)) return false
    if (!item.skipExisting) return true
    const last = lastByDigits.get(d)
    return !last || r.tx_date > last
  })
}

function isMultiAccount(item: QueueItem): boolean {
  return (item.parseResult?.accounts.length ?? 0) > 1
}

// 계좌별로 올릴 건수 (화면 표에 쓴다)
function accountRowCount(item: QueueItem, digits: string): number {
  const last = (item.previews ?? []).find(p => p.digits === digits)?.last_tx_date ?? null
  return (item.parseResult?.rows ?? []).filter(r =>
    digitsOf(r.account_number) === digits && (!item.skipExisting || !last || r.tx_date > last),
  ).length
}

const won = (n: number) => n.toLocaleString('ko-KR')

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
        {item.resultText ?? (
          <>완료 신규 {item.uploadResult?.insertedRows.toLocaleString()}건
          {(item.uploadResult?.skippedRows ?? 0) > 0 && ` · 중복 ${item.uploadResult?.skippedRows.toLocaleString()}건 건너뜀`}</>
        )}
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
  const [sourceType, setSourceType]   = useState<UploadSource>('bank')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const patchItem = useCallback((id: string, patch: Partial<QueueItem>) =>
    setQueue(q => q.map(item => item.id === id ? { ...item, ...patch } : item)), [])

  // ── 파싱 (은행 명세서만 — 카드류는 각 import API가 서버에서 파싱) ──
  const parseItem = useCallback(async (id: string, file: File) => {
    try {
      const result = await parseFile(file, 'bank')
      const fmt = result.detectedFormat ?? ''

      // 통합계좌 파일: 계좌가 2개 이상이면 은행명 입력 대신 계좌 확인 표를 쓴다
      if (result.accounts.length > 1) {
        patchItem(id, { status: 'ready', parseResult: result, bankName: '', accountNumber: '' })
        const res = await fetch('/api/upload/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ digits: result.accounts.map(a => a.digits) }),
        })
        const data = await res.json().catch(() => ({}))
        patchItem(id, { previews: (data.accounts ?? []) as AccountPreview[] })
        return
      }

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

  // ── 파일 추가 (현재 선택된 출처 탭 기준) ────────────────────
  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => /\.(csv|xlsx|xls)$/i.test(f.name))
    if (!arr.length) return
    const items: QueueItem[] = arr.map(file => ({
      id: uid(), file,
      source: sourceType,
      status: (sourceType === 'bank' ? 'parsing' : 'ready') as ItemStatus,
      parseResult: null,
      bankName: '', accountNumber: '',
      error: null, uploadResult: null, resultText: null,
      previews: null, skipExisting: true, excluded: [],
    }))
    setQueue(q => [...q, ...items])
    if (sourceType === 'bank') items.forEach(item => parseItem(item.id, item.file))
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
  const uploadBank = async (item: QueueItem) => {
    if (!item.parseResult) return
    const rows = selectedRows(item)
    if (!rows.length) {
      patchItem(item.id, { status: 'error', error: '올릴 거래가 없습니다 — 계좌 선택이나 기간 조건을 확인하세요.' })
      return
    }
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows,
        fileHash:       item.parseResult.fileHash,
        fileName:       item.parseResult.fileName,
        fileSize:       item.parseResult.fileSize,
        fileType:       item.parseResult.fileType,
        source:         'bank',
        bankName:       item.bankName,
        accountNumber:  item.accountNumber,
        detectedFormat: item.parseResult.detectedFormat,
      }),
    })
    if (res.status === 409) {
      const data = await res.json()
      patchItem(item.id, { status: 'duplicate', error: data.message })
      return
    }
    if (!res.ok) {
      const data = await res.json()
      patchItem(item.id, { status: 'error', error: data.error ?? '업로드 오류' })
      return
    }
    const result: UploadResult & { recheckedExisting?: boolean } = await res.json()
    patchItem(item.id, {
      status: 'success',
      uploadResult: result,
      // 동일 파일 재업로드(행 단위 재검사)였음을 표시 — 신규분만 추가됨
      resultText: result.recheckedExisting
        ? `기존 파일 재검사 — 신규 ${result.insertedRows.toLocaleString()}건 추가 · 기존 ${result.skippedRows.toLocaleString()}건 유지`
        : undefined,
    })
  }

  const uploadCard = async (item: QueueItem) => {
    const endpoint = item.source === 'card_sales' ? '/api/card-sales/import' : '/api/card-expenses/import'
    const fd = new FormData()
    fd.append('file', item.file)
    const res  = await fetch(endpoint, { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      patchItem(item.id, { status: 'error', error: data.error ?? '업로드 오류' })
      return
    }
    const parts = [`완료 신규 ${(data.created ?? 0).toLocaleString()}건`]
    if (data.updated) parts.push(`갱신 ${data.updated.toLocaleString()}건`)
    if (data.posted)  parts.push(`분개 ${data.posted.toLocaleString()}건`)
    if (data.skipped) parts.push(`제외 ${data.skipped.toLocaleString()}건`)
    patchItem(item.id, { status: 'success', resultText: parts.join(' · ') })
  }

  const handleUploadAll = async () => {
    const targets = queue.filter(i => i.status === 'ready' || i.status === 'need_input')
    if (!targets.length) return
    setIsUploading(true)

    for (const item of targets) {
      patchItem(item.id, { status: 'uploading' })
      try {
        if (item.source === 'bank') await uploadBank(item)
        else await uploadCard(item)
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
  // 완료 후 이동 버튼: 큐의 첫 성공 항목 기준
  const firstSuccess    = queue.find(i => i.status === 'success')
  const doneMeta        = SOURCE_META[firstSuccess?.source ?? 'bank']

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">파일 업로드</h1>
      <p className="text-gray-500 text-sm mb-5">
        업로드할 데이터 종류를 선택한 뒤, 파일을 여러 개 선택하거나 드래그해서 일괄 업로드하세요.
      </p>

      {/* 출처 선택 */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {(Object.keys(SOURCE_META) as UploadSource[]).map(t => (
          <button key={t} onClick={() => setSourceType(t)} disabled={isUploading}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              sourceType === t
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-gray-600 border-gray-300 hover:border-slate-500'
            }`}
          >
            {SOURCE_META[t].label}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-400 mb-4">{SOURCE_META[sourceType].hint}</p>

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
        <div className={`${queue.length > 0 ? 'text-xl' : 'text-4xl'} mb-1.5`}></div>
        <p className="text-gray-700 font-medium text-sm">
          {queue.length === 0 ? '파일을 드래그하거나 클릭해서 선택하세요' : '파일 추가 (드래그 또는 클릭)'}
        </p>
        <p className="text-gray-400 text-xs mt-0.5">
          {SOURCE_META[sourceType].label.replace(/^..\s/, '')} · CSV · XLSX · XLS · 다중 선택 가능
        </p>
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
              <div key={item.id} className={`px-4 py-3 ${
                item.status === 'error'     ? 'bg-red-50' :
                item.status === 'success'   ? 'bg-green-50' :
                item.status === 'duplicate' ? 'bg-amber-50' : 'bg-white'
              }`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">

                {/* 파일명 + 건수 + 종류 */}
                <div className="min-w-0 sm:w-56 shrink-0">
                  <p className="text-sm font-medium text-gray-800 truncate" title={item.file.name}>
                    {item.file.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    <span className="text-slate-500">{SOURCE_META[item.source].label.replace(/^..\s/, '')}</span>
                    {' · '}
                    {item.parseResult
                      ? `${item.parseResult.rows.length.toLocaleString()}건`
                      : `${(item.file.size / 1024).toFixed(1)} KB`}
                    {(item.parseResult?.warnings.length ?? 0) > 0 && (
                      <span className="ml-1 text-amber-500" title={item.parseResult!.warnings.join('\n')}>
                        {item.parseResult!.warnings.length}
                      </span>
                    )}
                  </p>
                  {(item.status === 'error' || item.status === 'duplicate') && item.error && (
                    <p className="text-xs text-red-500 mt-0.5 line-clamp-2">{item.error}</p>
                  )}
                </div>

                {/* 편집 필드 (단일 계좌 은행 명세서만: 은행명/계좌번호) */}
                {item.source === 'bank' && !isMultiAccount(item) && ['ready', 'need_input', 'uploading'].includes(item.status) && (
                  <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                    <input
                      type="text"
                      value={item.bankName}
                      onChange={e => patchItem(item.id, {
                        bankName: e.target.value,
                        status: e.target.value.trim() ? 'ready' : 'need_input',
                      })}
                      placeholder="은행명 *"
                      disabled={item.status === 'uploading' || isUploading}
                      className={`w-28 text-sm border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-400 ${
                        !item.bankName.trim() ? 'border-orange-300 bg-orange-50' : 'border-gray-300'
                      }`}
                    />
                    <input
                      type="text"
                      value={item.accountNumber}
                      onChange={e => patchItem(item.id, { accountNumber: e.target.value })}
                      placeholder="계좌번호 (선택)"
                      disabled={item.status === 'uploading' || isUploading}
                      className="w-36 text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-400"
                    />
                  </div>
                )}

                {/* 통합계좌 안내 (표는 아래 줄에) */}
                {item.source === 'bank' && isMultiAccount(item) && (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="px-2 py-0.5 text-xs bg-sky-50 text-sky-700 rounded-full whitespace-nowrap">
                      통합계좌 {item.parseResult!.accounts.length}개
                    </span>
                    <span className="text-xs text-gray-400 truncate">
                      계좌별로 나눠 올립니다 — 아래에서 확인
                    </span>
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

                {/* ── 통합계좌: 계좌별 업로드 확인 표 ── */}
                {item.source === 'bank' && isMultiAccount(item) && item.status !== 'success' && (
                  <div className="w-full mt-1 border-t border-gray-100 pt-3">
                    {!item.previews ? (
                      <p className="text-xs text-gray-400">계좌 확인 중…</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                          <label className="flex items-center gap-1.5 text-xs text-gray-600">
                            <input
                              type="checkbox"
                              checked={item.skipExisting}
                              disabled={isUploading || item.status === 'uploading'}
                              onChange={e => patchItem(item.id, { skipExisting: e.target.checked })}
                            />
                            이미 올라온 마지막 거래일 이후만 올리기
                          </label>
                          <span className="text-xs text-gray-400">
                            체크를 끄면 파일 전체를 올립니다 (중복 키가 같은 행은 자동으로 건너뜁니다)
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead className="text-gray-400 border-b border-gray-200">
                              <tr>
                                <th className="py-1.5 px-2 text-left font-medium">올림</th>
                                <th className="py-1.5 px-2 text-left font-medium">은행</th>
                                <th className="py-1.5 px-2 text-left font-medium">계좌번호</th>
                                <th className="py-1.5 px-2 text-right font-medium">파일</th>
                                <th className="py-1.5 px-2 text-left font-medium">파일 기간</th>
                                <th className="py-1.5 px-2 text-left font-medium">기존 마지막</th>
                                <th className="py-1.5 px-2 text-right font-medium">올릴 건수</th>
                              </tr>
                            </thead>
                            <tbody>
                              {item.parseResult!.accounts.map(a => {
                                const pv = item.previews!.find(p => p.digits === a.digits)
                                const off = item.excluded.includes(a.digits)
                                const cnt = off ? 0 : accountRowCount(item, a.digits)
                                return (
                                  <tr key={a.digits} className={`border-b border-gray-50 ${off ? 'opacity-40' : ''}`}>
                                    <td className="py-1.5 px-2">
                                      <input
                                        type="checkbox"
                                        checked={!off}
                                        disabled={isUploading || item.status === 'uploading'}
                                        onChange={e => patchItem(item.id, {
                                          excluded: e.target.checked
                                            ? item.excluded.filter(d => d !== a.digits)
                                            : [...item.excluded, a.digits],
                                        })}
                                      />
                                    </td>
                                    <td className="py-1.5 px-2 whitespace-nowrap">
                                      {pv?.db_bank_name ?? a.bank_name}
                                      {!pv?.bank_account_id && (
                                        <span className="ml-1 px-1 py-0.5 bg-orange-100 text-orange-700 rounded">신규 계좌</span>
                                      )}
                                      {pv?.db_account_type === 'overdraft' && (
                                        <span className="ml-1 px-1 py-0.5 bg-violet-50 text-violet-600 rounded">한도</span>
                                      )}
                                    </td>
                                    <td className="py-1.5 px-2 font-mono whitespace-nowrap text-gray-500">{a.account_number}</td>
                                    <td className="py-1.5 px-2 text-right text-gray-500">{won(a.rows)}</td>
                                    <td className="py-1.5 px-2 whitespace-nowrap text-gray-400">{a.first_date} ~ {a.last_date}</td>
                                    <td className="py-1.5 px-2 whitespace-nowrap text-gray-400">
                                      {pv?.last_tx_date ?? '-'}
                                      {pv?.tx_count ? <span className="ml-1 text-gray-300">({won(pv.tx_count)}건)</span> : null}
                                    </td>
                                    <td className={`py-1.5 px-2 text-right font-medium ${cnt > 0 ? 'text-slate-900' : 'text-gray-300'}`}>
                                      {won(cnt)}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-gray-200">
                                <td colSpan={6} className="py-1.5 px-2 text-right text-gray-500">올릴 거래 합계</td>
                                <td className="py-1.5 px-2 text-right font-bold text-slate-900">
                                  {won(selectedRows(item).length)}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* 통합계좌 업로드 결과 — 계좌별 */}
                {item.status === 'success' && item.uploadResult?.accountResults?.length ? (
                  <div className="w-full mt-1 border-t border-gray-100 pt-2">
                    <p className="text-xs text-gray-400 mb-1">계좌별 전송 건수</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {item.uploadResult.accountResults.map(r => (
                        <span key={r.account_number} className="text-xs text-gray-600">
                          {r.bank_name} <span className="font-mono text-gray-400">{r.account_number}</span>
                          {' '}{won(r.inserted)}건
                          {r.created && <span className="ml-1 text-orange-600">신규 계좌</span>}
                          {r.skipped > 0 && <span className="ml-1 text-red-500">미매칭 {won(r.skipped)}건</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
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
              <span className="text-orange-500 text-xs">은행명 미입력 {needInputCount}개 — 입력 후 업로드하거나 그대로 진행 가능</span>
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
                  href={doneMeta.doneHref}
                  className="px-5 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700"
                >
                  {doneMeta.doneLabel}
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
