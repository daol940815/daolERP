'use client'

// 은행 점포 (121, 2026-11-23 사용자 승인 — 시안 docs/mockups/은행점포_목록_시안.html 1번, B안)
// 은행연합회 점포 현황(기준월) 전체를 은행 · 지역별로 보고, 거래 없는 점포는 "매출처로 등록"으로 그 자리에서 매출처를 만든다.
// 영업용 칸(담당 · 단계)은 두지 않는다(2026-11-23 사용자 결정 가안) — 영업할 점포는 등록해서 지금처럼 지점 담당 · 영업일지로 관리.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Row {
  id: string; group_name: string; branch_name: string; display_name: string
  sido: string | null; sigungu: string | null; address: string | null; phone: string | null
  vendor_id: string | null; vendor_name: string | null; vendor_active: boolean | null; staff: string | null
}
interface Bundle {
  available: boolean; base_month: string | null
  kpi: { total: number; linked: number; unlinked: number; missing: number }
  banks: { group_name: string; total: number; unlinked: number }[]
  sidos: string[]; sigungus: string[]
  rows: Row[]; row_total: number
  missing_rows?: { id: string; name: string; group_name: string }[]
  can_edit?: boolean
}
type Status = 'all' | 'unlinked' | 'linked' | 'missing'
const n = (x: number) => x.toLocaleString('ko-KR')
const PAGE = 100

export default function BankBranchesPage() {
  const router = useRouter()
  const [b, setB] = useState<Bundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('unlinked')
  const [group, setGroup] = useState('')
  const [sido, setSido] = useState('')
  const [sigungu, setSigungu] = useState('')
  const [q, setQ] = useState('')
  const [qApplied, setQApplied] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000) }

  useEffect(() => { const t = setTimeout(() => setQApplied(q.trim()), 300); return () => clearTimeout(t) }, [q])
  useEffect(() => { setLimit(PAGE) }, [status, group, sido, sigungu, qApplied])

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ status, limit: String(limit) })
    if (group) p.set('group', group)
    if (sido) p.set('sido', sido)
    if (sigungu) p.set('sigungu', sigungu)
    if (qApplied) p.set('q', qApplied)
    const res = await fetch(`/api/vendor-hub/bank-branches?${p}`)
    const json = await res.json().catch(() => null)
    if (res.ok && json) setB(json)
    else flash(`조회 실패: ${json?.error ?? '알 수 없는 오류'}`)
    setLoading(false)
  }, [status, group, sido, sigungu, qApplied, limit])
  useEffect(() => { load() }, [load])

  const register = async (r: Row) => {
    setBusy(r.id)
    const res = await fetch('/api/vendor-hub/bank-branches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register', branch_id: r.id }),
    })
    const j = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { flash(j.error ?? '등록 실패'); return }
    router.push(`/sales-hub/${j.vendor_id}`)
  }

  const canEdit = !!b?.can_edit
  const kpi = b?.kpi
  const card = (s: Status, label: string, v: number | undefined, sub: string) => (
    <button onClick={() => setStatus(s)}
      className={`text-left bg-white border rounded-xl px-4 py-3 ${status === s ? 'border-slate-900 ring-1 ring-slate-900' : 'border-gray-200 hover:border-gray-300'}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-0.5 tabular-nums">{v == null ? '-' : n(v)}</div>
      <div className="text-[0.6875rem] text-gray-400">{sub}</div>
    </button>
  )

  return (
    <div className="p-6 max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-gray-500"><Link href="/sales-hub" className="text-blue-700 hover:underline">매출처 관리</Link> › 은행 점포</div>
          <h1 className="text-2xl font-bold text-gray-900">은행 점포</h1>
          <p className="text-sm mt-1 text-gray-500">
            은행연합회 점포 현황{b?.base_month ? ` (${b.base_month} 기준)` : ''} 전체입니다. 거래 없는 점포는 &ldquo;매출처로 등록&rdquo;을 누르면 은행연합회 표기로 매출처가 만들어지고, 그다음부터는 지점 담당 · 영업일지 · 주문을 지금처럼 씁니다.
          </p>
        </div>
      </div>
      {msg && <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">{msg}</div>}

      {b && !b.available ? (
        <div className="mt-6 bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-600">
          은행 점포 목록이 아직 준비되지 않았습니다(마이그레이션 121 실행 · 점포 적재 전). ERP 담당자에게 문의하세요.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
            {card('all', '전체 점포', kpi?.total, `${b?.banks.length ?? 0}개 은행`)}
            {card('linked', '매출처 있음', kpi?.linked, '거래 · 등록된 점포')}
            {card('unlinked', '미거래 점포', kpi?.unlinked, '매출처 없음 — 영업 대상')}
            {card('missing', '점포 목록에 없음', kpi?.missing, '은행 매출처 중 — 폐점 · 이름 변경 의심')}
          </div>

          <div className="flex gap-1.5 flex-wrap mt-3">
            <button onClick={() => { setGroup(''); setSido(''); setSigungu('') }}
              className={`px-2.5 py-1 rounded-full text-xs border ${!group ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-700 border-gray-300'}`}>전체 은행</button>
            {(b?.banks ?? []).map(x => (
              <button key={x.group_name} onClick={() => { setGroup(x.group_name); setSido(''); setSigungu('') }}
                className={`px-2.5 py-1 rounded-full text-xs border ${group === x.group_name ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-700 border-gray-300'}`}>
                {x.group_name} <span className="opacity-70 tabular-nums">{n(status === 'unlinked' ? x.unlinked : x.total)}</span>
              </button>
            ))}
          </div>

          {status !== 'missing' && (
            <div className="flex gap-2 flex-wrap items-center mt-3">
              <select value={sido} onChange={e => { setSido(e.target.value); setSigungu('') }} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                <option value="">시도: 전체</option>
                {(b?.sidos ?? []).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={sigungu} onChange={e => setSigungu(e.target.value)} disabled={!sido} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white disabled:bg-gray-50">
                <option value="">시군구: 전체</option>
                {(b?.sigungus ?? []).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="점포명 · 주소 · 전화 검색"
                className="flex-1 min-w-[14rem] border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              <span className="text-xs text-gray-500">{loading ? '불러오는 중…' : `${n(b?.row_total ?? 0)}곳`}</span>
            </div>
          )}

          {status === 'missing' ? (
            <div className="mt-3 bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <div className="px-4 pt-3 pb-2 text-xs text-gray-500">
                은행 업체의 지점형 매출처 중 이번 점포 목록과 연결되지 않은 곳입니다 — 폐점 · 통합 · 이름 변경이거나 점포가 아닌 곳(모임 · 부서)일 수 있습니다.
                상세에서 비슷한 점포로 연결하거나 &ldquo;점포 아님&rdquo;으로 표시하면 여기서 빠집니다.
              </div>
              <table className="w-full text-sm min-w-[480px]">
                <thead><tr className="bg-gray-50 text-gray-500 text-xs border-y border-gray-200">
                  <th className="py-2 px-3 text-left font-medium">은행</th><th className="py-2 px-3 text-left font-medium">매출처</th>
                </tr></thead>
                <tbody>
                  {(b?.missing_rows ?? []).map(m => (
                    <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 px-3 text-gray-600">{m.group_name}</td>
                      <td className="py-1.5 px-3"><Link href={`/sales-hub/${m.id}`} className="text-blue-700 hover:underline">{m.name}</Link></td>
                    </tr>
                  ))}
                  {!(b?.missing_rows ?? []).length && <tr><td colSpan={2} className="py-6 text-center text-gray-400 text-sm">없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-3 bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead><tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                  <th className="py-2 px-3 text-left font-medium">은행</th>
                  <th className="py-2 px-3 text-left font-medium">점포 (은행연합회)</th>
                  <th className="py-2 px-3 text-left font-medium">주소</th>
                  <th className="py-2 px-3 text-left font-medium">전화</th>
                  <th className="py-2 px-3 text-left font-medium">매출처</th>
                  <th className="py-2 px-3" />
                </tr></thead>
                <tbody>
                  {(b?.rows ?? []).map(r => (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 px-3 text-gray-600 whitespace-nowrap">{r.group_name}</td>
                      <td className="py-1.5 px-3">{r.branch_name}{r.display_name !== r.branch_name && <span className="text-[0.6875rem] text-gray-400 ml-1">→ {r.display_name}</span>}</td>
                      <td className="py-1.5 px-3 text-xs text-gray-600">{r.address ?? '-'}</td>
                      <td className="py-1.5 px-3 text-xs text-gray-600 whitespace-nowrap">{r.phone ?? '-'}</td>
                      <td className="py-1.5 px-3 text-xs">
                        {r.vendor_id ? (
                          <span className="inline-flex items-center gap-1.5 flex-wrap">
                            <Link href={`/sales-hub/${r.vendor_id}`} className="text-blue-700 hover:underline">{r.vendor_name}</Link>
                            {r.vendor_active === false && <span className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 text-[0.625rem]">비활성</span>}
                            {r.staff && <span className="text-gray-500">· {r.staff}</span>}
                          </span>
                        ) : <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">미거래</span>}
                      </td>
                      <td className="py-1.5 px-3 text-right whitespace-nowrap">
                        {!r.vendor_id && canEdit && (
                          <button disabled={!!busy} onClick={() => register(r)}
                            className="px-2 py-0.5 border border-gray-300 rounded text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                            {busy === r.id ? '등록 중…' : '매출처로 등록'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loading && !(b?.rows ?? []).length && <tr><td colSpan={6} className="py-6 text-center text-gray-400 text-sm">조건에 맞는 점포가 없습니다.</td></tr>}
                </tbody>
              </table>
              {(b?.row_total ?? 0) > (b?.rows.length ?? 0) && (
                <div className="p-3 text-center">
                  <button onClick={() => setLimit(l => l + PAGE)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                    더 보기 ({n((b?.row_total ?? 0) - (b?.rows.length ?? 0))}곳 남음)
                  </button>
                </div>
              )}
            </div>
          )}
          {!canEdit && <p className="text-[0.6875rem] text-gray-400 mt-2">매출처 등록은 거래처 관리 수정 권한이 필요합니다. 주문 · 상담 입력 중에는 지점 칸의 &ldquo;미등록 점포&rdquo;에서 바로 등록할 수 있습니다.</p>}
        </>
      )}
    </div>
  )
}
