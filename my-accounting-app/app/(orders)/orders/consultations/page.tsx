'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { honorify } from '@/lib/contact-label'

// 상담일지 목록 — 기본 본인 작성분, manager/admin은 전체 보기 전환 가능.
// 품목 행 단위 표시 (실무자 피드백 7, 2안): 상품 1개 = 1줄, 부자재·배송비 행 제외.
// 같은 상담의 줄들은 하나의 상담일지로 인식 — 행 클릭 = 상세, 전환도 상담 단위.
// 체크박스 "선택 복사": 같은 상담의 선택 품목으로 새 상담 프리필 (재주문 상담).

interface Row {
  id: string
  consult_date: string
  consult_type: string
  bank_name: string | null
  branch_name: string | null
  manager_name: string | null
  sender_name: string | null
  status: string
  writer: string | null
  consult_total: number
  line_no: number | null
  item_name: string | null
  quantity: number
  line_total: number
  has_discount: boolean
  item_status: string | null
  line_count: number
  master_linked: boolean
  // 주문 진행 요청 (705)
  order_assignee_id?: string | null
  order_requested_at?: string | null
  order_request_memo?: string | null
  assignee_name?: string | null
  requester_name?: string | null
  assigned_to_me?: boolean
  is_owner?: boolean
}
type Scope = 'mine' | 'assigned' | 'requested' | 'done'
interface Emp { id: string; name: string; team: string | null; position: string | null; employment_type?: string | null }

const won = (n: number) => (n ?? 0).toLocaleString('ko-KR')
const TYPE_BADGE: Record<string, string> = {
  '주문': 'bg-blue-100 text-blue-700', '문의': 'bg-gray-100 text-gray-600',
  '요청': 'bg-amber-100 text-amber-800', '결제': 'bg-violet-100 text-violet-700',
  '기타': 'bg-gray-100 text-gray-500',
}
const STATUS_BADGE: Record<string, string> = {
  '진행중': 'bg-amber-100 text-amber-800',
  '주문전환': 'bg-emerald-100 text-emerald-700',
  '종결': 'bg-gray-100 text-gray-500',
}
const chip = (on: boolean) =>
  `px-3 py-1 rounded-full text-xs border whitespace-nowrap ${
    on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'
  }`

export default function ConsultationsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [manager, setManager] = useState(false)      // 관리자급(isManagerLike) — 전체 보기 토글
  const [isParttime, setIsParttime] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')
  const [all, setAll] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  // 주문 진행 요청 (705, 2026-11-05) — 카드 = 범위
  const [scope, setScope] = useState<Scope>('mine')
  const [reqKpi, setReqKpi] = useState<{ mine: number; assigned: number; requested: number; done: number } | null>(null)
  const [reqFor, setReqFor] = useState<Row | null>(null)      // 행 "요청" 버튼 대상
  const [emps, setEmps] = useState<Emp[]>([])
  const [reqAssignee, setReqAssignee] = useState('')
  const [reqMemo, setReqMemo] = useState('')
  const [reqBusy, setReqBusy] = useState(false)
  const [reqErr, setReqErr] = useState<string | null>(null)
  useEffect(() => {   // 알림에서 ?scope=assigned 로 들어오는 경우
    try {
      const sc = new URLSearchParams(window.location.search).get('scope')
      if (sc === 'assigned' || sc === 'requested' || sc === 'done') setScope(sc)
    } catch { /* noop */ }
  }, [])
  const openRequest = async (r: Row) => {
    setReqFor(r); setReqErr(null)
    setReqAssignee(r.order_assignee_id ?? ''); setReqMemo(r.order_request_memo ?? '')
    if (!emps.length) {
      const res = await fetch('/api/orders-portal/masters')
      const j = await res.json().catch(() => ({}))
      if (res.ok) setEmps(j.employees ?? [])
    }
  }
  const submitRequest = async () => {
    if (!reqFor) return
    setReqBusy(true); setReqErr(null)
    const res = await fetch(`/api/orders-portal/consultations/${reqFor.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request', order_request: { assignee_id: reqAssignee || null, memo: reqMemo.trim() || null } }),
    })
    const j = await res.json().catch(() => ({}))
    setReqBusy(false)
    if (!res.ok) { setReqErr(j.error ?? '요청 실패'); return }
    setReqFor(null)
    load()
  }

  // 선택 복사 — 키는 "상담id:line_no" (같은 상담의 줄만 함께 복제 가능)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const toggleCheck = (key: string) =>
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const copySelected = () => {
    if (!checked.size) return
    const parsed = Array.from(checked).map(k => {
      const [id, line] = k.split(':')
      return { id, line: parseInt(line, 10) }
    })
    const ids = new Set(parsed.map(p => p.id))
    if (ids.size > 1) {
      alert('같은 상담일지의 품목만 함께 복사할 수 있습니다. 한 상담의 줄만 선택해주세요.')
      return
    }
    const id = parsed[0].id
    const lines = parsed.map(p => p.line).filter(n => Number.isFinite(n) && n > 0)
    router.push(`/orders/consultations/new?copy=${id}${lines.length ? `&lines=${lines.join(',')}` : ''}`)
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (status !== 'all') p.set('status', status)
    if (type !== 'all') p.set('type', type)
    if (all) p.set('all', '1')
    if (scope !== 'mine') p.set('scope', scope)
    p.set('page', String(page))
    const res = await fetch(`/api/orders-portal/consultations?${p}`)
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '조회 실패')
    else {
      setRows(json.rows); setManager(json.manager === true); setIsParttime(json.is_parttime === true)
      setTotalPages(json.total_pages ?? 1); setTotal(json.total ?? 0)
      setReqKpi(json.request_kpi ?? null)
    }
    setLoading(false)
  }, [q, status, type, all, page, scope])
  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [q, status, type, all, scope])

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">상담일지</h1>
        <span className="text-xs text-gray-400">상담 기록 → 주문 확정 시 주문서로 전환 · 품목별 1줄 표시 (같은 상담은 하나의 일지)</span>
        <span className="ml-auto flex items-center gap-2">
          {checked.size > 0 && (
            <button onClick={copySelected}
              className="px-3.5 py-1.5 border border-blue-300 text-blue-700 bg-blue-50 rounded-lg text-sm hover:bg-blue-100">
              선택 {checked.size}건 복사해 새 상담
            </button>
          )}
          <Link href="/orders/consultations/new"
            className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm">+ 상담 기록</Link>
        </span>
      </div>

      {/* 주문 진행 요청 카드 (705) — 클릭 = 범위 전환 */}
      {reqKpi && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 max-w-4xl">
          {([
            ['mine', '내 상담 (요청받은 것 포함)', reqKpi.mine, 'text-gray-900'],
            ['assigned', '나에게 요청됨 (진행 대기)', reqKpi.assigned, reqKpi.assigned ? 'text-orange-700' : 'text-gray-400'],
            ['requested', '내가 요청함 (진행 대기)', reqKpi.requested, 'text-gray-900'],
            ['done', '요청 완료 (이번 달 요청)', reqKpi.done, 'text-emerald-700'],
          ] as const).map(([key, title, val, cls]) => (
            <button key={key} onClick={() => setScope(key)}
              className={`bg-white border rounded-xl px-4 py-3 text-left ${scope === key ? 'border-slate-800' : 'border-gray-200'}`}>
              <div className="text-[0.6875rem] text-gray-400">{title}</div>
              <div className={`text-lg font-bold tabular-nums ${cls}`}>{val}</div>
            </button>
          ))}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-3 mt-4">
        <div className="flex items-center gap-2 flex-wrap">
          <input value={qInput} onChange={e => setQInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setQ(qInput.trim()) }}
            placeholder="검색 — 업체 · 지점 · 담당자 · 보내는분 · 상품명 · 메모 (띄어쓰기로 다중 조건, Enter)"
            className="flex-1 min-w-[260px] border border-gray-300 rounded-lg px-3.5 py-2 text-sm" />
          {q && <button onClick={() => { setQ(''); setQInput('') }} className="text-xs text-gray-400">해제 ✕</button>}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          {(['all', '진행중', '주문전환', '종결'] as const).map(s => (
            <button key={s} onClick={() => setStatus(s)} className={chip(status === s)}>{s === 'all' ? '전체' : s}</button>
          ))}
          <span className="w-2" />
          {(['all', '주문', '문의', '요청', '결제', '기타'] as const).map(t => (
            <button key={t} onClick={() => setType(t)} className={chip(type === t)}>{t === 'all' ? '구분 전체' : t}</button>
          ))}
          <span className="flex-1" />
          {manager && (
            <button onClick={() => setAll(v => !v)} className={chip(all)}>{all ? '전체 직원 보기 중' : '내 것만 보기 중'}</button>
          )}
        </div>
      </div>

      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg whitespace-pre-line">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-xl mt-3 overflow-x-auto">
        {loading ? <div className="text-center py-16 text-gray-400">로딩 중...</div> : (
          <table className="w-full text-sm min-w-[1020px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 pl-3 pr-1 w-8" title="선택 복사 — 같은 상담의 품목만 함께" />
                <th className="py-2 px-3 text-left font-medium">상담일</th>
                <th className="py-2 px-3 text-left font-medium">구분</th>
                <th className="py-2 px-3 text-left font-medium">업체(은행)</th>
                <th className="py-2 px-3 text-left font-medium">부서(지점)</th>
                <th className="py-2 px-3 text-left font-medium">담당자</th>
                {all && <th className="py-2 px-3 text-left font-medium">작성자</th>}
                <th className="py-2 px-3 text-left font-medium">상품명</th>
                <th className="py-2 px-3 text-right font-medium">수량</th>
                <th className="py-2 px-3 text-right font-medium" title="이 품목의 판매합계 — 상담 전체 합계는 마우스 오버">판매합계</th>
                <th className="py-2 px-3 text-left font-medium">보내는분</th>
                <th className="py-2 px-3 text-left font-medium">주문 진행</th>
                <th className="py-2 px-3 text-left font-medium">상태</th>
                <th className="py-2 px-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const key = `${r.id}:${r.line_no ?? 0}`
                return (
                <tr key={key}
                  onClick={() => {
                    // 아르바이트는 마스터 미연결 상담 접근 불가 ((b) 정책 — API도 403)
                    if (isParttime && !r.master_linked) {
                      alert('아르바이트 계정은 마스터 미연결 상담을 열 수 없습니다. 담당 직원에게 요청해주세요.')
                      return
                    }
                    router.push(`/orders/consultations/${r.id}`)
                  }}
                  className="border-b border-gray-50 cursor-pointer hover:bg-blue-50/40">
                  <td className="py-2 pl-3 pr-1" onClick={e => e.stopPropagation()}>
                    {r.line_no != null && (
                      <input type="checkbox" checked={checked.has(key)} onChange={() => toggleCheck(key)} />
                    )}
                  </td>
                  <td className="py-2 px-3 tabular-nums text-xs font-semibold">{r.consult_date}</td>
                  <td className="py-2 px-3">
                    <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${TYPE_BADGE[r.consult_type] ?? 'bg-gray-100 text-gray-500'}`}>
                      {r.consult_type}
                    </span>
                  </td>
                  <td className="py-2 px-3 font-semibold">{r.bank_name ?? '-'}</td>
                  <td className="py-2 px-3">{r.branch_name ?? <span className="text-gray-300">-</span>}</td>
                  <td className="py-2 px-3">{honorify(r.manager_name) || '-'}</td>
                  {all && <td className="py-2 px-3 text-xs">{r.writer ?? '-'}</td>}
                  <td className="py-2 px-3 text-xs">
                    {r.item_name ?? <span className="text-gray-300">품목 없음</span>}
                    {/* 할인·단가변경은 품목 줄에서 바로 보이게 (실무자 피드백 2) */}
                    {r.has_discount && (
                      <span className="ml-1.5 inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.625rem] font-medium bg-red-50 text-red-600">할인</span>
                    )}
                    {r.item_status && (
                      <span className="ml-1.5 inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.625rem] font-medium bg-amber-100 text-amber-800">{r.item_status}</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-xs">{r.quantity || <span className="text-gray-300">-</span>}</td>
                  <td className="py-2 px-3 text-right tabular-nums"
                    title={r.line_count > 1 ? `상담 전체 ${won(r.consult_total)}원 (품목 ${r.line_count}개)` : undefined}>
                    {r.line_total ? won(r.line_total) : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="py-2 px-3 text-xs">{r.sender_name ?? <span className="text-gray-300">-</span>}</td>
                  <td className="py-2 px-3 text-xs whitespace-nowrap" title={r.order_request_memo ?? undefined}>
                    {r.assigned_to_me ? (
                      <><span className="inline-block px-1.5 py-0.5 rounded text-[0.625rem] font-semibold bg-blue-50 text-blue-700 border border-blue-200">나에게 요청</span>
                        <span className="text-gray-500 ml-1">{r.requester_name ?? ''}</span></>
                    ) : r.assignee_name ? (
                      <span className="text-gray-600">{r.assignee_name}에게 요청</span>
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="py-2 px-3">
                    <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${STATUS_BADGE[r.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {r.status}
                    </span>
                    {/* (b) 정책: 지점·담당자 마스터 연결이 끝나야 주문 전환 가능 */}
                    {!r.master_linked && (
                      <span className="ml-1 inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.625rem] font-medium bg-orange-50 text-orange-600 border border-orange-200"
                        title="자유 입력된 업체·지점·담당자가 매출처 마스터에 연결되지 않았습니다 — 상담일지를 열어 마스터 등록/선택 후 전환할 수 있습니다">
                        마스터 미연결
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {/* 행 "요청" — 작성자 · 관리자급 (요청받은 직원에게는 안 보임) */}
                    {r.status === '진행중' && (r.is_owner || manager) && !r.assigned_to_me && (
                      <button onClick={e => { e.stopPropagation(); openRequest(r) }}
                        className="text-xs text-gray-600 hover:underline mr-2" title="다른 직원에게 주문 진행을 요청">
                        {r.assignee_name ? '요청 변경' : '요청'}
                      </button>
                    )}
                    {r.status === '진행중' && (
                      r.master_linked ? (
                        <button onClick={e => { e.stopPropagation(); router.push(`/orders/new?consult=${r.id}`) }}
                          className="text-xs text-blue-700 hover:underline"
                          title="상담 단위 전환 — 이 상담의 전체 품목이 주문서로 넘어갑니다">주문서로 전환</button>
                      ) : (
                        <span className="text-xs text-gray-300 cursor-not-allowed"
                          title="마스터 미연결 상담은 전환할 수 없습니다 — 상담일지에서 매출처 마스터 등록/선택 후 전환해주세요">주문서로 전환</span>
                      )
                    )}
                  </td>
                </tr>
                )
              })}
              {!rows.length && (
                <tr><td colSpan={all ? 14 : 13} className="text-center py-12 text-gray-400 text-sm">
                  상담 기록이 없습니다. 상단의 상담 기록 버튼으로 시작하세요.
                </td></tr>
              )}
            </tbody>
          </table>
        )}
        <div className="flex items-center px-4 py-2.5 text-xs text-gray-400 border-t border-gray-100">
          <span>{won(total)}줄 (품목 단위)</span>
          <span className="ml-auto flex items-center gap-1.5">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-2.5 py-1 border border-gray-200 rounded disabled:opacity-40">이전</button>
            <span className="tabular-nums">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="px-2.5 py-1 border border-gray-200 rounded disabled:opacity-40">다음</button>
          </span>
        </div>
      </div>
      {/* 행 "요청" 창 (705) */}
      {reqFor && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4" onClick={() => setReqFor(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-bold text-gray-900">주문 진행 요청 — {[reqFor.bank_name, reqFor.branch_name].filter(Boolean).join(' ') || '상담일지'}</div>
            <div className="text-[0.6875rem] text-gray-500 mt-0.5">요청받은 직원은 이 상담을 열람 · 주문 전환만 할 수 있습니다. 비우면 요청 취소.</div>
            <label className="block text-[0.6875rem] text-gray-500 mt-3 mb-0.5">주문 진행 담당</label>
            <select value={reqAssignee} onChange={e => setReqAssignee(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white">
              <option value="">요청 안 함 (내가 진행)</option>
              {emps.map(e => (
                <option key={e.id} value={e.id}>{e.name}{e.team || e.position ? ` (${[e.team, e.employment_type === 'parttime' ? '아르바이트' : e.position].filter(Boolean).join(' · ')})` : ''}</option>
              ))}
            </select>
            <label className="block text-[0.6875rem] text-gray-500 mt-2 mb-0.5">요청 메모 (선택)</label>
            <input value={reqMemo} onChange={e => setReqMemo(e.target.value)} disabled={!reqAssignee}
              placeholder="예: 11/10 출고 맞춰서 발주까지 부탁해요"
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-gray-50" />
            {emps.find(e => e.id === reqAssignee)?.employment_type === 'parttime' && !reqFor.master_linked && (
              <div className="mt-2 text-xs px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                마스터 미연결 상담은 아르바이트에게 요청할 수 없습니다 — 상담일지에서 먼저 연결하세요.
              </div>
            )}
            {reqErr && <div className="mt-2 text-xs text-red-600">{reqErr}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setReqFor(null)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">닫기</button>
              <button onClick={submitRequest} disabled={reqBusy}
                className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-50">
                {reqBusy ? '저장 중...' : reqAssignee ? '요청 보내기' : '요청 취소'}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-2">
        저장 시 업무일지에 자동 기재됩니다 · 주문 전환된 상담은 수정 잠금(이력 보존) ·
        체크박스로 품목을 선택해 이전 상담을 복사할 수 있습니다 (같은 상담의 품목만 함께)
      </p>
    </div>
  )
}
