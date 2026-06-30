'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AgGridReact } from 'ag-grid-react'
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type CellValueChangedEvent,
  type ICellRendererParams,
  type ValueGetterParams,
  type ValueSetterParams,
  type ValueFormatterParams,
} from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import type { Transaction, Account } from '@/types/transaction'
import type { BankAccount } from '@/types/bank-account'
import type { Vendor } from '@/types/tax-invoice'
import { PERIOD_PRESETS, getPeriodRange } from '@/lib/period-presets'
import SearchableCellEditor from '@/components/ui/SearchableCellEditor'

ModuleRegistry.registerModules([AllCommunityModule])

// 금액 포맷터
const amountFmt = (p: ValueFormatterParams<Transaction, number>) =>
  p.value ? p.value.toLocaleString('ko-KR') + '원' : ''

// 거래일자 포맷터 — tx_time이 있으면 "YYYY-MM-DD HH:MM"으로 표시
const txDateFmt = (p: ValueFormatterParams<Transaction, string>) => {
  if (!p.value) return ''
  const tx_time = p.data?.tx_time
  return tx_time ? `${p.value} ${tx_time.slice(0, 5)}` : p.value
}

// 거래일자+시간 정렬 비교 — tx_time이 없는 행은 같은 날짜 내에서 뒤로 정렬
const txDateComparator = (
  valueA: string, valueB: string,
  nodeA: { data?: Transaction } | null, nodeB: { data?: Transaction } | null,
) => {
  const a = `${valueA ?? ''} ${nodeA?.data?.tx_time ?? ''}`
  const b = `${valueB ?? ''} ${nodeB?.data?.tx_time ?? ''}`
  return a < b ? -1 : a > b ? 1 : 0
}

// 차변/대변 배지 렌더러
function SideBadge(p: ICellRendererParams<Transaction>) {
  if (p.value === '차변') return <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">차변</span>
  if (p.value === '대변') return <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">대변</span>
  return <span className="text-gray-300 text-xs">—</span>
}

// 상태 배지 렌더러
function StatusBadge(p: ICellRendererParams<Transaction>) {
  const map: Record<string, { label: string; cls: string }> = {
    pending:   { label: '미검토',  cls: 'bg-gray-100 text-gray-600' },
    reviewed:  { label: '검토완료', cls: 'bg-yellow-100 text-yellow-700' },
    confirmed: { label: '확정',    cls: 'bg-green-100 text-green-700' },
  }
  const s = map[p.value as string] ?? { label: p.value, cls: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  )
}

// 이번달 기본 날짜 범위 계산
function defaultDateRange() {
  const now = new Date()
  const localFmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return {
    from: localFmt(new Date(now.getFullYear(), now.getMonth(), 1)),
    to:   localFmt(now),
  }
}

interface Filters {
  from: string
  to: string
  status: string
  source: string
  bankAccountId: string
  vendorId: string
}

interface PreviewTx {
  id: string
  tx_date: string
  description: string | null
  account_alias: string | null
  bank_account_id: string | null
  amount_out?: number
  amount_in?: number
}
interface PreviewPair {
  out: PreviewTx
  in: PreviewTx
  pairType?: string  // 'standard' | 'minus-account'
}

interface MatchedPair {
  pair_id: string
  out: PreviewTx
  in: PreviewTx
}

function TransactionsContent() {
  const searchParams = useSearchParams()
  const bankAccountIdParam = searchParams.get('bankAccountId') ?? ''
  const vendorIdParam      = searchParams.get('vendorId') ?? ''

  const gridRef    = useRef<AgGridReact<Transaction>>(null)
  const uploadRef  = useRef<HTMLInputElement>(null)
  const [rowData,   setRowData]   = useState<Transaction[]>([])
  const [accounts,  setAccounts]  = useState<Account[]>([])
  const [vendors,   setVendors]   = useState<Vendor[]>([])
  const [banks,     setBanks]     = useState<BankAccount[]>([])
  const [loading,   setLoading]   = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [matching,   setMatching]   = useState(false)
  const [matchingVendors, setMatchingVendors] = useState(false)
  const [previewing,   setPreviewing]   = useState(false)
  const [previewPairs, setPreviewPairs] = useState<PreviewPair[] | null>(null)
  const [reviewing,    setReviewing]    = useState(false)
  const [matchedPairs,    setMatchedPairs]    = useState<MatchedPair[] | null>(null)
  const [matchedTruncated, setMatchedTruncated] = useState(false)
  const [unlinking,       setUnlinking]       = useState<string | null>(null)
  const [importing,    setImporting]    = useState(false)
  const [selectedCount, setSelectedCount] = useState(0)
  const [autoFetchFlag, setAutoFetchFlag] = useState(0)
  const [filters, setFilters]     = useState<Filters>({
    ...defaultDateRange(),
    status: 'all',
    source: 'all',
    bankAccountId: bankAccountIdParam,
    vendorId: vendorIdParam,
  })
  const [toast, setToast]         = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [keywordPrompt, setKeywordPrompt] = useState<{ accountId: string; accountName: string; keyword: string } | null>(null)
  const [journalPreview, setJournalPreview] = useState<{
    tx: Transaction
    data: {
      preview: { entry_date: string; description: string | null; lines: { side: string; account_code: string | null; account_name: string; amount: number; vendor_name: string | null }[] } | null
      reason?: string; balanced?: boolean; debit?: number; credit?: number
    }
  } | null>(null)

  // 토스트 메시지 (3초 후 자동 닫힘)
  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // 계정과목 맵 (id → name)
  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map(a => [a.id, a])),
    [accounts],
  )

  // 거래처 맵 (id → name)
  const vendorMap = useMemo(
    () => Object.fromEntries(vendors.map(v => [v.id, v])),
    [vendors],
  )

  // URL param(bankAccountId/vendorId) 변경 시 필터 동기화 + 자동 조회
  useEffect(() => {
    setFilters(f => ({ ...f, bankAccountId: bankAccountIdParam, vendorId: vendorIdParam }))
    // 필터 파라미터가 바뀌면 현재 필터(날짜·상태·출처)를 유지한 채 즉시 재조회
    setAutoFetchFlag(n => n + 1)
  }, [bankAccountIdParam, vendorIdParam])

  // 계정과목 + 거래처 목록 로드 (마운트 1회)
  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then(d => { if (d.data) setAccounts(d.data) })
      .catch(() => null)
    fetch('/api/vendors?all=true')
      .then(r => r.json())
      .then(d => { if (d.data) setVendors(d.data) })
      .catch(() => null)
  }, [])

  // 은행 계좌 목록(잔액 포함) 조회 — 거래 변경 후 잔액 갱신에 재사용
  const fetchBanks = useCallback(() => {
    fetch('/api/bank-accounts', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (d.data) setBanks(d.data) })
      .catch(() => null)
  }, [])

  useEffect(() => { fetchBanks() }, [fetchBanks])

  // 거래 내역 조회
  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        status: filters.status,
        source: filters.source,
        ...(filters.from           && { from: filters.from }),
        ...(filters.to             && { to:   filters.to   }),
        ...(filters.bankAccountId  && { bankAccountId: filters.bankAccountId }),
        ...(filters.vendorId       && { vendorId: filters.vendorId }),
      })
      const res  = await fetch(`/api/transactions?${params}`)
      const json = await res.json()
      if (json.data) setRowData(json.data)
      else showToast(json.error ?? '조회 실패', 'err')
    } catch {
      showToast('서버 연결 실패', 'err')
    } finally {
      setLoading(false)
    }
  }, [filters, showToast])

  // 초기 로드 + bankAccountId 변경 시 자동 재조회
  useEffect(() => { fetchTransactions() }, [autoFetchFlag]) // eslint-disable-line react-hooks/exhaustive-deps

  // 셀 편집 저장 (계정과목 / 메모)
  const onCellValueChanged = useCallback(async (event: CellValueChangedEvent<Transaction>) => {
    const { data, colDef } = event
    const colId = colDef.colId ?? colDef.field ?? ''

    let body: Record<string, unknown> = {}

    if (colId === 'account') {
      // valueSetter에서 confirmed_account_id를 이미 갱신해 둠
      body = {
        confirmed_account_id: data.confirmed_account_id ?? null,
        status: data.confirmed_account_id ? 'reviewed' : 'pending',
      }
      // 행 상태도 즉시 반영
      data.status = data.confirmed_account_id ? 'reviewed' : 'pending'
      event.api.refreshCells({ rowNodes: [event.node!], columns: ['status'], force: true })
    } else if (colId === 'side') {
      body = { suggested_side: data.suggested_side ?? null }
    } else if (colId === 'vendor') {
      // valueSetter에서 vendor_id를 이미 갱신해 둠
      body = { vendor_id: data.vendor_id ?? null }
    } else if (colDef.field === 'memo') {
      body = { memo: data.memo ?? null }
    } else {
      return
    }

    const res = await fetch(`/api/transactions/${data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { showToast('저장 실패', 'err'); return }

    // 자동 분류 결과와 다른 계정으로 직접 분류한 경우 → 키워드 학습 제안
    if (colId === 'account' && data.confirmed_account_id && data.confirmed_account_id !== data.suggested_account_id) {
      const account = accounts.find(a => a.id === data.confirmed_account_id)
      const desc = (data.description ?? '').trim()
      const already = (account?.keywords ?? []).some(kw => desc.toLowerCase().includes(kw.toLowerCase()))
      if (account && desc && !already) {
        setKeywordPrompt({ accountId: account.id, accountName: account.name, keyword: desc })
      }
    }
  }, [showToast, accounts])

  // 키워드 학습 제안 적용
  const handleAddKeyword = useCallback(async () => {
    if (!keywordPrompt) return
    const kw = keywordPrompt.keyword.trim()
    if (!kw) { setKeywordPrompt(null); return }
    const account = accounts.find(a => a.id === keywordPrompt.accountId)
    const existing = account?.keywords ?? []
    if (existing.includes(kw)) { showToast('이미 등록된 키워드입니다'); setKeywordPrompt(null); return }

    const res = await fetch(`/api/accounts/${keywordPrompt.accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: [...existing, kw] }),
    })
    if (res.ok) {
      setAccounts(prev => prev.map(a => a.id === keywordPrompt.accountId ? { ...a, keywords: [...existing, kw] } : a))
      showToast(`"${kw}" 키워드 추가 완료`)
    } else {
      showToast('키워드 추가 실패', 'err')
    }
    setKeywordPrompt(null)
  }, [keywordPrompt, accounts, showToast])

  // 선택된 행 일괄 확정 (분개 자동 전기)
  const handleBulkConfirm = useCallback(async () => {
    const selected = gridRef.current?.api.getSelectedRows() as Transaction[]
    if (!selected?.length) return
    const ids = selected.map(r => r.id)
    const res = await fetch('/api/transactions/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, confirm: true }),
    })
    const json = await res.json()
    if (!res.ok) { showToast(json.error ?? '확정 실패', 'err'); return }
    const parts = [`${json.confirmed ?? 0}건 확정·전기`]
    if (json.skipped?.length) parts.push(`${json.skipped.length}건 건너뜀(계정/이체)`)
    if (json.errors?.length)  parts.push(`${json.errors.length}건 오류`)
    showToast(parts.join(' · '), json.errors?.length ? 'err' : 'ok')
    fetchTransactions()
  }, [fetchTransactions, showToast])

  // 선택된 행 일괄 확정 해제 (분개 취소)
  const handleBulkUnconfirm = useCallback(async () => {
    const selected = gridRef.current?.api.getSelectedRows() as Transaction[]
    if (!selected?.length) return
    const ids = selected.map(r => r.id)
    const res = await fetch('/api/transactions/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, confirm: false }),
    })
    const json = await res.json()
    if (!res.ok) { showToast(json.error ?? '해제 실패', 'err'); return }
    showToast(`${json.unconfirmed ?? 0}건 확정 해제`, 'ok')
    fetchTransactions()
  }, [fetchTransactions, showToast])

  // 분개 미리보기 (단건 선택)
  const handlePreviewJournal = useCallback(async () => {
    const selected = gridRef.current?.api.getSelectedRows() as Transaction[]
    if (selected?.length !== 1) { showToast('미리보기는 1건만 선택하세요.', 'err'); return }
    const res = await fetch(`/api/transactions/${selected[0].id}/journal-preview`)
    const json = await res.json()
    if (!res.ok) { showToast(json.error ?? '미리보기 실패', 'err'); return }
    setJournalPreview({ tx: selected[0], data: json })
  }, [showToast])

  // 선택된 행 삭제
  const handleBulkDelete = useCallback(async () => {
    const selected = gridRef.current?.api.getSelectedRows() as Transaction[]
    if (!selected?.length) return
    if (!window.confirm(`선택한 ${selected.length}건을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return

    const ids = selected.map(r => r.id)
    const res = await fetch('/api/transactions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    if (res.ok) {
      showToast(`${ids.length}건 삭제 완료`)
      fetchTransactions()
      fetchBanks()  // 거래 삭제로 최신 잔액이 바뀌므로 계좌 잔액도 갱신
    } else {
      showToast('삭제 실패', 'err')
    }
  }, [fetchTransactions, fetchBanks, showToast])

  // 자동 분류 실행
  const handleClassify = useCallback(async () => {
    setClassifying(true)
    try {
      const body = filters.bankAccountId ? { bank_account_id: filters.bankAccountId } : {}
      const res  = await fetch('/api/transactions/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      showToast(json.message ?? '분류 완료')
      fetchTransactions()
    } catch {
      showToast('자동 분류 실패', 'err')
    } finally {
      setClassifying(false)
    }
  }, [filters.bankAccountId, fetchTransactions, showToast])

  // 이체 거래 쌍 자동 매칭
  const handleMatchTransfers = useCallback(async () => {
    setMatching(true)
    try {
      const body = filters.bankAccountId ? { bank_account_id: filters.bankAccountId } : {}
      const res  = await fetch('/api/transactions/match-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.matched > 0) {
        showToast(`${json.matched}쌍 이체 매칭 완료`)
        fetchTransactions()
      } else {
        showToast('매칭 가능한 이체 거래 없음')
      }
    } catch {
      showToast('이체 매칭 실패', 'err')
    } finally {
      setMatching(false)
    }
  }, [filters.bankAccountId, fetchTransactions, showToast])

  // 거래처 자동 매칭 (적요/입금자명 ↔ 거래처명·별칭·사업자번호)
  const handleMatchVendors = useCallback(async () => {
    setMatchingVendors(true)
    try {
      const res  = await fetch('/api/transactions/match-vendors', { method: 'POST' })
      const json = await res.json()
      if (json.matched > 0) {
        showToast(`${json.matched}건 거래처 매칭 완료`)
        fetchTransactions()
      } else {
        showToast('매칭 가능한 거래 없음')
      }
    } catch {
      showToast('거래처 매칭 실패', 'err')
    } finally {
      setMatchingVendors(false)
    }
  }, [fetchTransactions, showToast])

  // 미분류 거래 엑셀 다운로드
  const handleExport = useCallback(() => {
    const params = new URLSearchParams({
      ...(filters.from          && { from: filters.from }),
      ...(filters.to            && { to:   filters.to   }),
      ...(filters.bankAccountId && { bankAccountId: filters.bankAccountId }),
    })
    const a = document.createElement('a')
    a.href = `/api/transactions/export-unclassified?${params}`
    a.click()
  }, [filters.from, filters.to, filters.bankAccountId])

  // 전체 거래 엑셀 다운로드 (현재 필터 그대로)
  const handleExportAll = useCallback(() => {
    const params = new URLSearchParams({
      ...(filters.status !== 'all' && { status: filters.status }),
      ...(filters.source !== 'all' && { source: filters.source }),
      ...(filters.from          && { from: filters.from }),
      ...(filters.to            && { to:   filters.to   }),
      ...(filters.bankAccountId && { bankAccountId: filters.bankAccountId }),
      ...(filters.vendorId      && { vendorId: filters.vendorId }),
    })
    const a = document.createElement('a')
    a.href = `/api/transactions/export?${params}`
    a.click()
  }, [filters])

  // 엑셀 업로드 → 계정과목 일괄 업데이트
  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''  // 같은 파일 재업로드 허용

    setImporting(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res  = await fetch('/api/transactions/import-classifications', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) { showToast(json.error ?? '업로드 실패', 'err'); return }

      let msg = `${json.updated}건 계정과목 업데이트 완료`
      if (json.unknownAccounts?.length) {
        msg += ` (미인식 계정: ${(json.unknownAccounts as string[]).join(', ')})`
      }
      showToast(msg, json.unknownAccounts?.length ? 'err' : 'ok')
      fetchTransactions()
    } catch {
      showToast('업로드 실패', 'err')
    } finally {
      setImporting(false)
    }
  }, [fetchTransactions, showToast])

  // 이체 매칭 미리보기 (드라이런)
  const handlePreview = useCallback(async () => {
    setPreviewing(true)
    try {
      const params = new URLSearchParams()
      if (filters.bankAccountId) params.set('bank_account_id', filters.bankAccountId)
      const res  = await fetch(`/api/transactions/match-transfers?${params}`)
      const json = await res.json()
      setPreviewPairs(json.pairs ?? [])
    } catch {
      showToast('미리보기 조회 실패', 'err')
    } finally {
      setPreviewing(false)
    }
  }, [filters.bankAccountId, showToast])

  // 현재 매칭된 쌍 검토 모달 열기
  const handleReview = useCallback(async () => {
    setReviewing(true)
    try {
      const res  = await fetch('/api/transactions/matched-pairs')
      const json = await res.json()
      setMatchedPairs(json.pairs ?? [])
      setMatchedTruncated(json.truncated ?? false)
    } catch {
      showToast('매칭 내역 조회 실패', 'err')
    } finally {
      setReviewing(false)
    }
  }, [showToast])

  // 특정 쌍 매칭 해제
  const handleUnlink = useCallback(async (pairId: string) => {
    setUnlinking(pairId)
    try {
      const res = await fetch('/api/transactions/match-transfers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair_id: pairId }),
      })
      if (res.ok) {
        setMatchedPairs(prev => prev?.filter(p => p.pair_id !== pairId) ?? null)
        fetchTransactions()
      } else {
        showToast('매칭 해제 실패', 'err')
      }
    } finally {
      setUnlinking(null)
    }
  }, [fetchTransactions, showToast])

  // 통계 계산
  // 이체쌍 조회용 Map: transfer_pair_id → 해당 쌍의 모든 거래 목록
  const pairMap = useMemo(() => {
    const m = new Map<string, Transaction[]>()
    for (const tx of rowData) {
      if (!tx.transfer_pair_id) continue
      if (!m.has(tx.transfer_pair_id)) m.set(tx.transfer_pair_id, [])
      m.get(tx.transfer_pair_id)!.push(tx)
    }
    return m
  }, [rowData])

  const stats = useMemo(() => {
    const totalIn     = rowData.reduce((s, r) => s + (r.amount_in ?? 0), 0)
    const totalOut    = rowData.reduce((s, r) => s + (r.amount_out ?? 0), 0)
    const pending     = rowData.filter(r => r.status === 'pending').length
    const unclassified = rowData.filter(r => !r.confirmed_account_id && !r.suggested_account_id).length
    return { totalIn, totalOut, pending, unclassified, total: rowData.length }
  }, [rowData])

  // AG Grid 컬럼 정의 (accounts 로드 후 memo 필드 처리 포함)
  const colDefs = useMemo<ColDef<Transaction>[]>(() => [
    {
      headerCheckboxSelection: true,
      checkboxSelection: true,
      width: 48,
      pinned: 'left',
      resizable: false,
      sortable: false,
      filter: false,
    },
    {
      field: 'tx_date',
      headerName: '거래일자',
      width: 145,
      pinned: 'left',
      sort: 'desc',
      valueFormatter: txDateFmt,
      comparator: txDateComparator,
    },
    {
      field: 'description',
      headerName: '내용/적요',
      flex: 1,
      minWidth: 180,
    },
    {
      field: 'counterparty_name',
      headerName: '보낸분/받는분',
      width: 140,
      valueFormatter: (p) => p.value ?? '',
    },
    {
      field: 'amount_in',
      headerName: '입금액',
      width: 130,
      type: 'numericColumn',
      valueFormatter: amountFmt,
      cellStyle: { color: '#2563eb', fontWeight: 500 },
    },
    {
      field: 'amount_out',
      headerName: '출금액',
      width: 130,
      type: 'numericColumn',
      valueFormatter: amountFmt,
      cellStyle: { color: '#dc2626', fontWeight: 500 },
    },
    {
      field: 'balance',
      headerName: '잔액',
      width: 130,
      type: 'numericColumn',
      valueFormatter: (p) => p.value != null ? p.value.toLocaleString('ko-KR') + '원' : '',
      cellStyle: (p) => ({ color: (p.value ?? 0) < 0 ? '#dc2626' : '#6b7280' }),
    },
    {
      // 계정과목 인라인 편집 컬럼
      colId: 'account',
      headerName: '계정과목',
      width: 155,
      editable: true,
      cellEditor: SearchableCellEditor,
      cellEditorPopup: true,
      cellEditorParams: () => ({
        values: ['(미분류)', ...accounts.map(a => a.name)],
      }),
      // 표시: confirmed → 볼드, suggested → 이탤릭 회색, 없음 → 연회색
      valueGetter: (p: ValueGetterParams<Transaction>) => {
        const id = p.data?.confirmed_account_id ?? p.data?.suggested_account_id
        if (!id) return '(미분류)'
        return accountMap[id]?.name ?? '(미분류)'
      },
      // 편집 완료 시 이름 → ID 역변환하여 confirmed_account_id에 저장
      valueSetter: (p: ValueSetterParams<Transaction>) => {
        if (!p.data) return false
        const acct = accounts.find(a => a.name === p.newValue)
        p.data.confirmed_account_id = acct?.id ?? null
        return true
      },
      cellClass: (p) => {
        if (!p.data) return ''
        if (p.data.confirmed_account_id) return 'font-semibold text-gray-900'
        if (p.data.suggested_account_id) return 'italic text-gray-500'
        return 'text-gray-300'
      },
    },
    {
      // 거래처 인라인 편집 컬럼
      colId: 'vendor',
      headerName: '거래처',
      width: 150,
      editable: true,
      cellEditor: SearchableCellEditor,
      cellEditorPopup: true,
      cellEditorParams: () => ({
        values: ['(미지정)', ...vendors.map(v => v.name)],
      }),
      valueGetter: (p: ValueGetterParams<Transaction>) => {
        const id = p.data?.vendor_id
        if (!id) return '(미지정)'
        return vendorMap[id]?.name ?? '(미지정)'
      },
      valueSetter: (p: ValueSetterParams<Transaction>) => {
        if (!p.data) return false
        const vendor = vendors.find(v => v.name === p.newValue)
        p.data.vendor_id = vendor?.id ?? null
        return true
      },
      cellClass: (p) => p.data?.vendor_id ? 'text-gray-900' : 'text-gray-300',
    },
    {
      colId: 'side',
      headerName: '차/대변',
      width: 90,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: ['차변', '대변', '(초기화)'] },
      valueGetter: (p: ValueGetterParams<Transaction>) => {
        const s = p.data?.suggested_side
        if (s === 'debit')  return '차변'
        if (s === 'credit') return '대변'
        return null
      },
      valueSetter: (p: ValueSetterParams<Transaction>) => {
        if (!p.data) return false
        if (p.newValue === '차변')      p.data.suggested_side = 'debit'
        else if (p.newValue === '대변') p.data.suggested_side = 'credit'
        else                            p.data.suggested_side = null
        return true
      },
      cellRenderer: SideBadge,
    },
    {
      field: 'memo',
      headerName: '메모',
      width: 150,
      editable: true,
      cellEditorParams: { maxLength: 200 },
    },
    {
      field: 'status',
      headerName: '상태',
      width: 100,
      cellRenderer: StatusBadge,
    },
    {
      field: 'transfer_pair_id',
      headerName: '이체쌍',
      width: 130,
      sortable: false,
      cellRenderer: (p: ICellRendererParams<Transaction>) => {
        if (!p.value) return <span className="text-gray-300 text-xs">—</span>
        const pair  = pairMap.get(p.value as string)
        const other = pair?.find(t => t.id !== p.data?.id)
        const alias = other?.account_alias ?? null
        const amt   = other
          ? ((other.amount_in ?? 0) > 0 ? other.amount_in : other.amount_out)
          : null
        return (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 cursor-default max-w-full"
            title={`이체쌍 ID: ${p.value}`}
          >
            🔗 {alias ?? '이체쌍'}{amt ? ` ${(amt as number).toLocaleString('ko-KR')}` : ''}
          </span>
        )
      },
    },
    {
      field: 'source',
      headerName: '출처',
      width: 70,
      valueFormatter: (p) => p.value === 'bank' ? '은행' : p.value === 'card' ? '카드' : p.value,
    },
    {
      field: 'account_alias',
      headerName: '계좌',
      width: 140,
    },
  ], [accounts, accountMap, vendors, vendorMap, pairMap])

  // 현재 선택된 은행 정보 (이름 + 잔액)
  const activeBank = useMemo(() => {
    if (!filters.bankAccountId) return null
    return banks.find(b => b.id === filters.bankAccountId) ?? null
  }, [filters.bankAccountId, banks])

  // 거래처 필터 배지 표시용
  const activeVendor = useMemo(() => {
    if (!filters.vendorId) return null
    return vendorMap[filters.vendorId] ?? null
  }, [filters.vendorId, vendorMap])

  return (
    <div className="p-6 flex flex-col h-full">
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">거래 내역</h1>
        {activeBank && (
          <span className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-full text-sm font-medium">
            🏦 {activeBank.bank_name}
            {activeBank.current_balance !== null && (
              <span className="text-slate-500 font-normal">
                잔액 <strong className={activeBank.current_balance < 0 ? 'text-red-600' : 'text-slate-800'}>
                  {activeBank.current_balance.toLocaleString('ko-KR')}원
                </strong>
              </span>
            )}
            <a
              href="/transactions"
              className="ml-1 text-slate-400 hover:text-slate-600 leading-none"
              title="필터 해제"
            >
              ✕
            </a>
          </span>
        )}
        {activeVendor && (
          <span className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-sm font-medium">
            🏢 {activeVendor.name}
            <a
              href="/transactions"
              className="ml-1 text-indigo-400 hover:text-indigo-600 leading-none"
              title="필터 해제"
            >
              ✕
            </a>
          </span>
        )}
      </div>
      <p className="text-gray-500 text-sm mb-4">계정과목 클릭으로 직접 분류하거나, 자동 분류를 사용하세요.</p>

      {/* 기간 빠른 선택 */}
      <div className="flex flex-wrap items-center gap-1 mb-2">
        {PERIOD_PRESETS.map(p => (
          <button
            key={p}
            onClick={() => setFilters(f => ({ ...f, ...getPeriodRange(p) }))}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-slate-100 hover:border-slate-400 transition-colors"
          >
            {p}
          </button>
        ))}
        <button
          onClick={() => setFilters(f => ({ ...f, from: '', to: '' }))}
          className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-slate-100 hover:border-slate-400 transition-colors"
        >
          전체
        </button>
        {(filters.from || filters.to) && (
          <span className="text-xs text-gray-400 ml-1">· 기간: {filters.from || '처음'} ~ {filters.to || '현재'}</span>
        )}
      </div>

      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="date" value={filters.from}
          onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <span className="text-gray-400 text-sm">~</span>
        <input
          type="date" value={filters.to}
          onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <select
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
        >
          <option value="all">전체 상태</option>
          <option value="pending">미검토</option>
          <option value="reviewed">검토완료</option>
          <option value="confirmed">확정</option>
        </select>
        <select
          value={filters.source}
          onChange={e => setFilters(f => ({ ...f, source: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
        >
          <option value="all">전체 출처</option>
          <option value="bank">은행</option>
          <option value="card">카드</option>
        </select>
        <button
          onClick={fetchTransactions}
          disabled={loading}
          className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? '조회 중...' : '조회'}
        </button>
      </div>

      {/* 요약 + 액션 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        {/* 통계 */}
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="text-gray-500">총 <strong className="text-gray-900">{stats.total.toLocaleString()}건</strong></span>
          <span className="text-blue-600">입금 <strong>{stats.totalIn.toLocaleString()}원</strong></span>
          <span className="text-red-600">출금 <strong>{stats.totalOut.toLocaleString()}원</strong></span>
          {stats.pending > 0 && (
            <span className="text-orange-500">미검토 <strong>{stats.pending}건</strong></span>
          )}
          {stats.unclassified > 0 && (
            <span className="text-gray-400">미분류 <strong>{stats.unclassified}건</strong></span>
          )}
        </div>

        {/* 액션 버튼 */}
        <div className="flex gap-2 flex-wrap">
          {/* 숨겨진 파일 입력 */}
          <input
            ref={uploadRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleImport}
          />
          <button
            onClick={handleExportAll}
            className="px-3 py-1.5 border border-emerald-300 rounded-lg text-sm text-emerald-700 hover:bg-emerald-50"
          >
            ↓ 전체 다운로드
          </button>
          <button
            onClick={handleExport}
            className="px-3 py-1.5 border border-emerald-300 rounded-lg text-sm text-emerald-700 hover:bg-emerald-50"
          >
            📥 미분류 다운로드
          </button>
          <button
            onClick={() => uploadRef.current?.click()}
            disabled={importing}
            className="px-3 py-1.5 border border-emerald-300 rounded-lg text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            {importing ? '업로드 중...' : '📤 엑셀 업로드'}
          </button>
          <button
            onClick={handleClassify}
            disabled={classifying}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {classifying ? '분류 중...' : '✨ 자동 분류'}
          </button>
          <button
            onClick={handleReview}
            disabled={reviewing}
            className="px-3 py-1.5 border border-purple-300 rounded-lg text-sm text-purple-700 hover:bg-purple-50 disabled:opacity-50"
          >
            {reviewing ? '조회 중...' : '📋 매칭 검토'}
          </button>
          <button
            onClick={handlePreview}
            disabled={previewing}
            className="px-3 py-1.5 border border-purple-300 rounded-lg text-sm text-purple-700 hover:bg-purple-50 disabled:opacity-50"
          >
            {previewing ? '조회 중...' : '🔍 매칭 확인'}
          </button>
          <button
            onClick={handleMatchTransfers}
            disabled={matching}
            className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
          >
            {matching ? '매칭 중...' : '🔗 계정 이체 매칭'}
          </button>
          <button
            onClick={handleMatchVendors}
            disabled={matchingVendors}
            className="px-3 py-1.5 border border-indigo-300 rounded-lg text-sm text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            {matchingVendors ? '매칭 중...' : '🏢 거래처 자동 매칭'}
          </button>
          {selectedCount === 1 && (
            <button
              onClick={handlePreviewJournal}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50"
            >
              🔍 분개 미리보기
            </button>
          )}
          {selectedCount > 0 && (
            <>
              <button
                onClick={handleBulkConfirm}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
              >
                선택 {selectedCount}건 확정
              </button>
              <button
                onClick={handleBulkUnconfirm}
                className="px-3 py-1.5 border border-green-300 rounded-lg text-sm font-medium text-green-700 hover:bg-green-50"
              >
                확정 해제
              </button>
              <button
                onClick={handleBulkDelete}
                className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
              >
                선택 {selectedCount}건 삭제
              </button>
            </>
          )}
        </div>
      </div>

      {/* AG Grid */}
      <div className="ag-theme-quartz flex-1 rounded-lg overflow-hidden border border-gray-200" style={{ minHeight: 400 }}>
        <AgGridReact<Transaction>
          ref={gridRef}
          rowData={rowData}
          columnDefs={colDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true }}
          rowSelection="multiple"
          suppressRowClickSelection
          onSelectionChanged={(e) => setSelectedCount(e.api.getSelectedRows().length)}
          onCellValueChanged={onCellValueChanged}
          getRowStyle={(p) => {
            if (p.data?.status === 'confirmed') return { background: '#f0fdf4' }
            if (p.data?.status === 'reviewed')  return { background: '#fefce8' }
            return undefined
          }}
          pagination
          paginationPageSize={50}
          suppressMovableColumns
          overlayNoRowsTemplate={
            loading
              ? '<span class="text-gray-400">조회 중...</span>'
              : '<span class="text-gray-400">조회된 거래가 없습니다. 필터를 확인하거나 파일을 업로드하세요.</span>'
          }
        />
      </div>

      {/* 안내 문구 */}
      <p className="text-xs text-gray-400 mt-2">
        계정과목 셀 클릭 → 드롭다운으로 분류 &nbsp;·&nbsp; 메모 셀 클릭 → 직접 입력 &nbsp;·&nbsp; 행 체크 후 선택 확정으로 일괄 확정(분개 자동 생성)
      </p>

      {/* 분개 미리보기 모달 */}
      {journalPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setJournalPreview(null)}>
          <div className="bg-white rounded-xl shadow-2xl p-5 w-[440px] max-w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900">분개 미리보기</h3>
            <p className="text-xs text-gray-400 mb-3 mt-0.5 truncate">{journalPreview.tx.tx_date} · {journalPreview.tx.description ?? ''}</p>
            {journalPreview.data.preview ? (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-200">
                      <th className="text-left py-1.5 font-medium">구분</th>
                      <th className="text-left py-1.5 font-medium">계정과목</th>
                      <th className="text-right py-1.5 font-medium">금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journalPreview.data.preview.lines.map((l, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="py-1.5">
                          {l.side === 'debit'
                            ? <span className="text-blue-600 font-medium">차변</span>
                            : <span className="text-red-600 font-medium">대변</span>}
                        </td>
                        <td className="py-1.5">{l.account_name}{l.vendor_name ? <span className="text-gray-400"> · {l.vendor_name}</span> : null}</td>
                        <td className="py-1.5 text-right font-medium">{l.amount.toLocaleString()}원</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className={`text-xs mt-2 ${journalPreview.data.balanced ? 'text-gray-400' : 'text-red-600'}`}>
                  차변 {(journalPreview.data.debit ?? 0).toLocaleString()} / 대변 {(journalPreview.data.credit ?? 0).toLocaleString()} {journalPreview.data.balanced ? '✓ 균형' : '⚠ 불균형'}
                </p>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => setJournalPreview(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">닫기</button>
                  <button
                    onClick={async () => {
                      const id = journalPreview.tx.id
                      const res = await fetch('/api/transactions/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id], confirm: true }) })
                      const j = await res.json()
                      setJournalPreview(null)
                      if (!res.ok || j.errors?.length) { showToast(j.error ?? '확정 실패', 'err'); return }
                      showToast('확정·전기 완료', 'ok')
                      fetchTransactions()
                    }}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                  >
                    이대로 확정
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-amber-600 py-2">{journalPreview.data.reason ?? '분개를 만들 수 없습니다.'}</p>
                <button onClick={() => setJournalPreview(null)} className="w-full mt-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">닫기</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 이체 매칭 검토 모달 (기존 매칭 쌍 — 개별 해제 가능) */}
      {matchedPairs !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">이체 매칭 검토</h2>
                <p className="text-xs text-slate-500 mt-0.5">잘못 매칭된 쌍은 &quot;해제&quot; 버튼으로 개별 해제할 수 있습니다.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-purple-700 bg-purple-50 px-3 py-1 rounded-full">
                  {matchedPairs.length}쌍
                </span>
                {matchedTruncated && (
                  <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                    ⚠ 5,000쌍 초과 — 일부만 표시됨
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-auto flex-1 px-6 py-4">
              {matchedPairs.length === 0 ? (
                <p className="text-slate-400 text-sm py-8 text-center">현재 매칭된 이체 쌍이 없습니다.</p>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b sticky top-0 bg-white">
                      <th className="pb-2 pr-2 font-medium w-5 text-center">#</th>
                      <th className="pb-2 pr-3 font-medium">출금 계좌</th>
                      <th className="pb-2 pr-3 font-medium">날짜</th>
                      <th className="pb-2 pr-3 font-medium">내용</th>
                      <th className="pb-2 pr-4 font-medium text-right">출금액</th>
                      <th className="pb-2 px-2 font-medium text-center text-purple-400">↔</th>
                      <th className="pb-2 pr-3 font-medium">입금 계좌</th>
                      <th className="pb-2 pr-3 font-medium">날짜</th>
                      <th className="pb-2 pr-3 font-medium">내용</th>
                      <th className="pb-2 pr-3 font-medium text-right">입금액</th>
                      <th className="pb-2 font-medium text-center">해제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchedPairs.map((pair, i) => (
                      <tr key={pair.pair_id} className="border-b border-slate-50 hover:bg-slate-50 text-xs">
                        <td className="py-2 pr-2 text-slate-400 text-center">{i + 1}</td>
                        <td className="py-2 pr-3 text-slate-700 font-medium">{pair.out?.account_alias ?? '—'}</td>
                        <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{(pair.out?.tx_date as string)?.slice(0, 10) ?? '—'}</td>
                        <td className="py-2 pr-3 text-slate-600 max-w-[150px] truncate" title={pair.out?.description ?? ''}>{pair.out?.description ?? '—'}</td>
                        <td className="py-2 pr-4 text-red-600 font-medium text-right whitespace-nowrap">
                          {/* 마이너스 통장은 amount_out=0이므로 amount_in으로 폴백 */}
                          {(() => { const a = (pair.out?.amount_out as number) || (pair.out?.amount_in as number); return a ? a.toLocaleString('ko-KR') + '원' : '—' })()}
                        </td>
                        <td className="py-2 px-2 text-purple-400 text-center font-bold">↔</td>
                        <td className="py-2 pr-3 text-slate-700 font-medium">{pair.in?.account_alias ?? '—'}</td>
                        <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{(pair.in?.tx_date as string)?.slice(0, 10) ?? '—'}</td>
                        <td className="py-2 pr-3 text-slate-600 max-w-[150px] truncate" title={pair.in?.description ?? ''}>{pair.in?.description ?? '—'}</td>
                        <td className="py-2 pr-3 text-blue-600 font-medium text-right whitespace-nowrap">
                          {(() => { const a = (pair.in?.amount_in as number) || (pair.in?.amount_out as number); return a ? a.toLocaleString('ko-KR') + '원' : '—' })()}
                        </td>
                        <td className="py-2 text-center">
                          <button
                            onClick={() => handleUnlink(pair.pair_id)}
                            disabled={unlinking === pair.pair_id}
                            className="px-2 py-1 text-xs rounded border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors"
                          >
                            {unlinking === pair.pair_id ? '...' : '해제'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-6 py-4 border-t flex items-center justify-end">
              <button
                onClick={() => { setMatchedPairs(null); fetchTransactions() }}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 이체 매칭 미리보기 모달 */}
      {previewPairs !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">이체 매칭 미리보기</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  동일 금액 + ±1일 + 다른 계좌 조건으로 매칭 가능한 쌍 (저장되지 않음)
                </p>
              </div>
              <span className="text-sm font-medium text-purple-700 bg-purple-50 px-3 py-1 rounded-full">
                {previewPairs.length}쌍
              </span>
            </div>

            <div className="overflow-auto flex-1 px-6 py-4">
              {previewPairs.length === 0 ? (
                <p className="text-slate-400 text-sm py-8 text-center">매칭 가능한 이체 거래가 없습니다.</p>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b">
                      <th className="pb-2 pr-3 font-medium w-5 text-center">#</th>
                      <th className="pb-2 pr-3 font-medium">출금 계좌</th>
                      <th className="pb-2 pr-3 font-medium">날짜</th>
                      <th className="pb-2 pr-3 font-medium">내용</th>
                      <th className="pb-2 pr-4 font-medium text-right">금액</th>
                      <th className="pb-2 px-2 font-medium text-center text-purple-400">↔</th>
                      <th className="pb-2 pr-3 font-medium">입금 계좌</th>
                      <th className="pb-2 pr-3 font-medium">날짜</th>
                      <th className="pb-2 pr-3 font-medium">내용</th>
                      <th className="pb-2 font-medium text-right">금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewPairs.map((pair, i) => {
                      const isMinus = pair.pairType === 'minus-account'
                      const outAmt  = isMinus ? (pair.out.amount_in as number) : (pair.out.amount_out as number)
                      const inAmt   = pair.in.amount_in as number
                      return (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 text-xs">
                        <td className="py-2 pr-3 text-slate-400 text-center">{i + 1}</td>
                        <td className="py-2 pr-3 text-slate-700 font-medium">
                          {pair.out.account_alias ?? '—'}
                          {isMinus && <span className="ml-1 text-orange-500 text-[10px]">마이너스</span>}
                        </td>
                        <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{(pair.out.tx_date as string).slice(0, 10)}</td>
                        <td className="py-2 pr-3 text-slate-600 max-w-[160px] truncate" title={pair.out.description ?? ''}>{pair.out.description ?? '—'}</td>
                        <td className="py-2 pr-4 text-red-600 font-medium text-right whitespace-nowrap">
                          {outAmt?.toLocaleString('ko-KR')}원
                        </td>
                        <td className="py-2 px-2 text-purple-400 text-center font-bold">↔</td>
                        <td className="py-2 pr-3 text-slate-700 font-medium">{pair.in.account_alias ?? '—'}</td>
                        <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{(pair.in.tx_date as string).slice(0, 10)}</td>
                        <td className="py-2 pr-3 text-slate-600 max-w-[160px] truncate" title={pair.in.description ?? ''}>{pair.in.description ?? '—'}</td>
                        <td className="py-2 text-blue-600 font-medium text-right whitespace-nowrap">
                          {inAmt?.toLocaleString('ko-KR')}원
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-6 py-4 border-t flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">
                미확정 쌍은 저장되지 않습니다. &quot;이체 매칭 실행&quot;을 눌러야 DB에 반영됩니다.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPreviewPairs(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
                >
                  닫기
                </button>
                {previewPairs.length > 0 && (
                  <button
                    onClick={() => {
                      setPreviewPairs(null)
                      handleMatchTransfers()
                    }}
                    disabled={matching}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
                  >
                    {matching ? '매칭 중...' : `${previewPairs.length}쌍 계정 이체 매칭 실행`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 키워드 학습 제안 */}
      {keywordPrompt && (
        <div className="fixed bottom-6 left-6 max-w-md px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg shadow-lg z-50 flex flex-wrap items-center gap-2">
          <span className="text-sm text-amber-800">
            🔖 <strong>{keywordPrompt.accountName}</strong>에 키워드를 추가해 다음에도 자동 분류되게 할까요?
          </span>
          <input
            value={keywordPrompt.keyword}
            onChange={e => setKeywordPrompt(p => p && { ...p, keyword: e.target.value })}
            className="border border-amber-300 rounded px-2 py-1 text-sm flex-1 min-w-[140px] focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          <button onClick={handleAddKeyword} className="px-3 py-1 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700">
            추가
          </button>
          <button onClick={() => setKeywordPrompt(null)} className="px-3 py-1 text-xs text-amber-700 hover:underline">
            건너뛰기
          </button>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm text-white z-50 transition-all ${
          toast.type === 'ok' ? 'bg-green-600' : 'bg-red-600'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400 text-sm">로딩 중...</div>}>
      <TransactionsContent />
    </Suspense>
  )
}
