// 발주서 '수정 내용 반영' (519, 2026-11-27 사용자 결정 — 나안, 시안 project-files mockups/발주서_수정반영_시안.html)
//
// 발주 뒤 주문 품목을 고치면 바뀐 품목은 취소 + 새 행이 되고(lib/orders-portal.ts applyOrderEdit), 발주서 줄은 취소된 옛 행을
// 계속 가리킨다 → 새 행은 미발주, 주문은 부분발주. 직원이 고친 내용을 업체에 다시 보낸 뒤 이 기능으로:
//  - 발주서 줄을 새 품목 행에 다시 연결하고 발주서에 적힌 수량 · 단가 · 금액을 새 값으로 바꾼다(relink)
//  - 주문에서 빠진 품목의 줄은 '짝 없음'으로 표시한다(remove — 지우지 않음, 엑셀 · 합계에서 빠짐)
//  - 수정본에 함께 넣어 보낸 새 품목을 이 발주서에 더한다(add, 선택)
// 시스템은 짝을 추천만 하고 직원이 확인한다. 추천 = 같은 품목 연결(product_id) → 같은 품번 → 남은 후보가 하나뿐일 때.
// 품목명 글자와 업로드한 엑셀 내용은 보지 않는다(사용자 지적 2026-11-19 — 고친 품목명이 품목 관리와 달라 집계가 틀어질 수 있음).
// 반영 조건(사용자 결정): 주문 수정 뒤에 이 발주서의 발송 기록(메일 또는 수동)이 있어야 한다 — 업체에 안 알린 채 발주완료가 되지 않게.
// 주문 품목 · 매출 · 매입 집계는 바꾸지 않는다. 바뀌는 것은 발주서 줄과 발주서 합계뿐이다.
import type { SupabaseClient } from '@supabase/supabase-js'
import { poLineValues, type OrderItemRow } from './purchase-orders'
import { writeEditLogs } from './orders-portal'

export const PO_REVISE_MIGRATION_HINT = '519 마이그레이션(발주서 수정 반영)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'

type AnyRow = Record<string, unknown>
type ItemRow = OrderItemRow & {
  order_id: string; created_at: string; is_prepayment: boolean
  purchase_alias_id: string | null; stock_role?: string | null
}
interface PoLine {
  id: string; line_no: number; order_item_id: string | null
  item_code: string | null; item_name: string | null; order_kind: string | null
  quantity: number; purchase_price: number; purchase_shipping: number; purchase_total: number; memo: string | null
}

export interface RevisePlanLine {
  po_item_id: string; line_no: number
  item_name: string | null; quantity: number; purchase_price: number; purchase_total: number
  stale: boolean                       // 가리키는 주문 품목이 취소됐거나 없음 → 짝을 정해야 하는 줄
  suggested: string | null             // 추천 짝 (주문 품목 id)
  suggest_reason: string | null
}
export interface ReviseCandidate {
  id: string; line_no: number; item_code: string | null; item_name: string | null
  quantity: number; purchase_price: number; purchase_total: number   // 발주서에 적힐 값 (판매가 발주면 판매 기준)
  diff: Record<string, string>         // 이 후보를 짝으로 고르면 바뀌는 칸 (po_item_id → '수량 30 → 10' …)
}
export interface RevisePlan {
  po: { id: string; po_no: string; vendor_name: string; total_amount: number; status: string; order_id: string }
  edited_at: string | null             // 주문 품목을 마지막으로 고친 시각
  basis: { id: string | null; sent_at: string; method: string; attachment_names: string[]; sender_name: string | null } | null
  lines: RevisePlanLine[]
  candidates: ReviseCandidate[]
  use_sale: boolean
}

const won = (n: number) => Math.round(n).toLocaleString('ko-KR')

async function loadContext(admin: SupabaseClient, poId: string) {
  const { data: po, error } = await admin.from('erp_purchase_orders')
    .select('id, po_no, order_id, vendor_id, vendor_name, purchase_alias_id, total_amount, status, sent_at, send_method')
    .eq('id', poId).maybeSingle()
  if (error || !po) return { error: '발주서를 찾을 수 없습니다.', status: 404 }

  const lineRes = await admin.from('erp_purchase_order_items')
    .select('id, line_no, order_item_id, item_code, item_name, order_kind, quantity, purchase_price, purchase_shipping, purchase_total, memo, removed_at')
    .eq('po_id', poId).order('line_no')
  if (lineRes.error) {
    return /removed_at/i.test(lineRes.error.message)
      ? { error: PO_REVISE_MIGRATION_HINT, status: 409 }
      : { error: lineRes.error.message, status: 500 }
  }
  const allLines = (lineRes.data ?? []) as (PoLine & { removed_at: string | null })[]
  const lines = allLines.filter(l => !l.removed_at)

  const { data: itemData, error: iErr } = await admin.from('erp_order_items')
    .select('*').eq('order_id', po.order_id as string).order('line_no')
  if (iErr) return { error: iErr.message, status: 500 }
  const items = (itemData ?? []) as unknown as ItemRow[]

  // 이 주문의 유효 발주서들(다른 매입처 포함)에 이미 연결된 품목 — 짝 후보에서 뺀다
  const { data: pos } = await admin.from('erp_purchase_orders').select('id').eq('order_id', po.order_id as string).eq('status', 'active')
  const linked = new Set<string>()
  const posIds = (pos ?? []).map(p => p.id as string)
  if (posIds.length) {
    const { data: pl } = await admin.from('erp_purchase_order_items')
      .select('order_item_id').in('po_id', posIds).is('removed_at', null).not('order_item_id', 'is', null)
    for (const r of pl ?? []) linked.add(r.order_item_id as string)
  }

  // 판매가 발주 매입처(요아럽)는 발주서 값이 판매 기준
  let useSale = false
  if (po.vendor_id) {
    const { data: v, error: vErr } = await admin.from('vendors').select('po_use_sale_price').eq('id', po.vendor_id as string).maybeSingle()
    if (!vErr) useSale = (v as { po_use_sale_price?: boolean } | null)?.po_use_sale_price === true
  }
  return { po: po as AnyRow, allLines, lines, items, linked, useSale }
}

type Ctx = Exclude<Awaited<ReturnType<typeof loadContext>>, { error: string }>

function staleAndCandidates(ctx: Ctx) {
  const { po, lines, items, linked } = ctx
  const byId = new Map(items.map(it => [it.id, it]))
  const stale = lines.filter(l => !l.order_item_id || !byId.has(l.order_item_id) || byId.get(l.order_item_id)!.is_canceled)
  const sameVendor = (it: ItemRow) => po.purchase_alias_id
    ? it.purchase_alias_id === po.purchase_alias_id
    : (it.purchase_vendor_name ?? '') === (po.vendor_name ?? '')
  const candidates = items.filter(it =>
    !it.is_canceled && !it.is_prepayment && it.stock_role !== 'out' && !linked.has(it.id) && sameVendor(it))
  return { byId, stale, candidates }
}

// 주문 품목을 마지막으로 고친 시각: 새로 생긴 후보 행의 등록 시각과 '품목 취소 · 추가' 변경 이력 중 늦은 것
async function editedAtOf(admin: SupabaseClient, orderId: string, candidates: ItemRow[]): Promise<string | null> {
  let t: string | null = null
  for (const c of candidates) if (c.created_at && (!t || c.created_at > t)) t = c.created_at
  const { data } = await admin.from('erp_order_edit_logs').select('created_at')
    .eq('order_id', orderId).in('field_label', ['품목 취소', '품목 추가'])
    .order('created_at', { ascending: false }).limit(1)
  const logT = (data?.[0]?.created_at as string | undefined) ?? null
  if (logT && (!t || logT > t)) t = logT
  return t
}

// 반영 근거: 주문 수정 뒤의 성공한 발송 기록(메일 · 수동). 510 미적용이면 발주서의 마지막 발송 시각으로 본다
async function basisOf(admin: SupabaseClient, po: AnyRow, editedAt: string | null): Promise<RevisePlan['basis']> {
  const { data, error } = await admin.from('erp_po_send_logs')
    .select('id, method, attachment_names, sent_at, ok, sender:employees!erp_po_send_logs_sent_by_fkey(name)')
    .eq('po_id', po.id as string).eq('ok', true).order('sent_at', { ascending: false }).limit(1)
  if (!error) {
    const l = data?.[0] as AnyRow | undefined
    if (!l || (editedAt && (l.sent_at as string) <= editedAt)) return null
    return {
      id: l.id as string, sent_at: l.sent_at as string, method: l.method as string,
      attachment_names: (l.attachment_names as string[] | null) ?? [],
      sender_name: (l.sender as { name?: string } | null)?.name ?? null,
    }
  }
  const sentAt = po.sent_at as string | null
  if (!sentAt || (editedAt && sentAt <= editedAt)) return null
  return { id: null, sent_at: sentAt, method: (po.send_method as string) ?? 'manual', attachment_names: [], sender_name: null }
}

function diffText(line: PoLine, v: ReturnType<typeof poLineValues>): string {
  const parts: string[] = []
  if ((line.item_name ?? '') !== (v.item_name ?? '')) parts.push(`품명 ${line.item_name ?? '-'} → ${v.item_name ?? '-'}`)
  if (Number(line.quantity) !== Number(v.quantity)) parts.push(`수량 ${line.quantity} → ${v.quantity}`)
  if (Number(line.purchase_price) !== Number(v.purchase_price)) parts.push(`단가 ${won(Number(line.purchase_price))} → ${won(Number(v.purchase_price))}`)
  if (Number(line.purchase_shipping) !== Number(v.purchase_shipping)) parts.push(`배송비 ${won(Number(line.purchase_shipping))} → ${won(Number(v.purchase_shipping))}`)
  if ((line.memo ?? '') !== (v.memo ?? '')) parts.push('비고')
  if (!parts.length && Number(line.purchase_total) !== Number(v.purchase_total)) parts.push(`금액 ${won(Number(line.purchase_total))} → ${won(Number(v.purchase_total))}`)
  return parts.join(', ') || '바뀐 칸 없음'
}

export async function buildRevisePlan(admin: SupabaseClient, poId: string): Promise<RevisePlan | { error: string; status: number }> {
  const ctx = await loadContext(admin, poId)
  if ('error' in ctx) return { error: ctx.error as string, status: ctx.status as number }
  const { po, lines, useSale } = ctx
  const { byId, stale, candidates } = staleAndCandidates(ctx)
  const editedAt = await editedAtOf(admin, po.order_id as string, candidates)
  const basis = await basisOf(admin, po, editedAt)

  // 추천: 같은 품목 연결 → 같은 품번 → (남은 줄 1 · 남은 후보 1)
  const taken = new Set<string>()
  const suggest = new Map<string, { id: string; reason: string }>()
  const pick = (test: (l: PoLine, old: ItemRow | undefined, c: ItemRow) => boolean, reason: string) => {
    for (const l of stale) {
      if (suggest.has(l.id)) continue
      const old = l.order_item_id ? byId.get(l.order_item_id) : undefined
      const hits = candidates.filter(c => !taken.has(c.id) && test(l, old, c))
      if (hits.length === 1) { suggest.set(l.id, { id: hits[0].id, reason }); taken.add(hits[0].id) }
    }
  }
  pick((_l, old, c) => !!old?.product_id && old.product_id === c.product_id, '같은 품목 · 같은 매입처')
  pick((l, old, c) => { const code = old?.item_code || l.item_code; return !!code && code === c.item_code }, '같은 품번 · 같은 매입처')
  const leftLines = stale.filter(l => !suggest.has(l.id))
  const leftCands = candidates.filter(c => !taken.has(c.id))
  if (leftLines.length === 1 && leftCands.length === 1) suggest.set(leftLines[0].id, { id: leftCands[0].id, reason: '남은 후보가 하나뿐' })

  return {
    po: {
      id: po.id as string, po_no: po.po_no as string, vendor_name: po.vendor_name as string,
      total_amount: Number(po.total_amount ?? 0), status: po.status as string, order_id: po.order_id as string,
    },
    edited_at: editedAt,
    basis,
    lines: lines.map(l => ({
      po_item_id: l.id, line_no: l.line_no, item_name: l.item_name,
      quantity: Number(l.quantity), purchase_price: Number(l.purchase_price), purchase_total: Number(l.purchase_total),
      stale: stale.includes(l),
      suggested: suggest.get(l.id)?.id ?? null,
      suggest_reason: suggest.get(l.id)?.reason ?? null,
    })),
    candidates: candidates.map(c => {
      const v = poLineValues(c, useSale)
      return {
        id: c.id, line_no: c.line_no, item_code: c.item_code, item_name: c.item_name,
        quantity: v.quantity, purchase_price: Number(v.purchase_price), purchase_total: Number(v.purchase_total),
        diff: Object.fromEntries(stale.map(l => [l.id, diffText(l, v)])),
      }
    }),
    use_sale: useSale,
  }
}

export interface ReviseInput {
  pairs: { po_item_id: string; order_item_id: string | null }[]
  add_item_ids: string[]
}

export async function applyRevision(
  admin: SupabaseClient,
  poId: string,
  input: ReviseInput,
  editor: { employeeId: string | null; employeeName: string | null },
): Promise<{ ok: true; total_before: number; total_after: number } | { error: string; status: number }> {
  const ctx = await loadContext(admin, poId)
  if ('error' in ctx) return { error: ctx.error as string, status: ctx.status as number }
  const { po, allLines, lines, useSale } = ctx
  if (po.status !== 'active') return { error: '취소된 발주서입니다.', status: 400 }
  const { stale, candidates } = staleAndCandidates(ctx)
  if (!stale.length && !input.add_item_ids.length) return { error: '반영할 내용이 없습니다 — 주문 수정으로 바뀐 줄이 없습니다.', status: 400 }

  const editedAt = await editedAtOf(admin, po.order_id as string, candidates)
  const basis = await basisOf(admin, po, editedAt)
  if (!basis) {
    return { error: '주문 수정 뒤에 이 발주서를 보낸 기록이 없습니다. 발송 페이지에서 수정본을 보내거나 수동 발송 기록을 남긴 뒤 반영하세요.', status: 409 }
  }

  // 검증: 바뀐 줄은 모두 짝(또는 짝 없음)이 정해져야 하고, 후보는 한 번씩만
  const candById = new Map(candidates.map(c => [c.id, c]))
  const staleIds = new Set(stale.map(l => l.id))
  const pairOf = new Map(input.pairs.map(p => [p.po_item_id, p.order_item_id]))
  for (const p of input.pairs) {
    if (!staleIds.has(p.po_item_id)) return { error: '반영 대상이 아닌 발주서 줄이 포함되어 있습니다. 창을 닫고 다시 열어 주세요.', status: 400 }
  }
  for (const l of stale) {
    if (!pairOf.has(l.id)) return { error: `발주서 ${l.line_no}줄의 짝을 골라 주세요(없으면 '짝 없음').`, status: 400 }
  }
  const used = new Set<string>()
  for (const id of [...input.pairs.map(p => p.order_item_id).filter(Boolean) as string[], ...input.add_item_ids]) {
    if (!candById.has(id)) return { error: '고를 수 없는 주문 품목이 포함되어 있습니다(이미 발주됐거나 다른 매입처). 창을 닫고 다시 열어 주세요.', status: 400 }
    if (used.has(id)) return { error: '같은 주문 품목을 두 번 고를 수 없습니다.', status: 400 }
    used.add(id)
  }

  const snap = (l: PoLine) => ({
    order_item_id: l.order_item_id, item_name: l.item_name, quantity: Number(l.quantity),
    purchase_price: Number(l.purchase_price), purchase_shipping: Number(l.purchase_shipping),
    purchase_total: Number(l.purchase_total), memo: l.memo,
  })
  const changes: AnyRow[] = []
  const now = new Date().toISOString()
  const totalBefore = lines.reduce((s, l) => s + Number(l.purchase_total ?? 0), 0)
  let totalAfter = lines.filter(l => !staleIds.has(l.id)).reduce((s, l) => s + Number(l.purchase_total ?? 0), 0)

  for (const l of stale) {
    const target = pairOf.get(l.id) ?? null
    if (target) {
      const v = poLineValues(candById.get(target)!, useSale)
      const { error } = await admin.from('erp_purchase_order_items').update({ order_item_id: target, ...v }).eq('id', l.id)
      if (error) return { error: `발주서 줄 갱신 실패: ${error.message}`, status: 500 }
      totalAfter += Number(v.purchase_total ?? 0)
      changes.push({ action: 'relink', po_line_no: l.line_no, before: snap(l), after: { order_item_id: target, ...v } })
    } else {
      const { error } = await admin.from('erp_purchase_order_items').update({ removed_at: now }).eq('id', l.id)
      if (error) return { error: `발주서 줄 표시 실패: ${error.message}`, status: 500 }
      changes.push({ action: 'remove', po_line_no: l.line_no, before: snap(l), after: null })
    }
  }

  if (input.add_item_ids.length) {
    let next = allLines.reduce((m, l) => Math.max(m, l.line_no), 0)
    const rows = input.add_item_ids
      .map(id => candById.get(id)!)
      .sort((a, b) => a.line_no - b.line_no)
      .map(c => ({ po_id: poId, line_no: ++next, order_item_id: c.id, ...poLineValues(c, useSale) }))
    const { error } = await admin.from('erp_purchase_order_items').insert(rows)
    if (error) return { error: `발주서 줄 추가 실패: ${error.message}`, status: 500 }
    for (const r of rows) {
      totalAfter += Number(r.purchase_total ?? 0)
      const { line_no, order_item_id, ...v } = r
      changes.push({ action: 'add', po_line_no: line_no, before: null, after: { order_item_id, ...v, po_id: undefined } })
    }
  }

  totalAfter = Math.round(totalAfter)
  const { error: tErr } = await admin.from('erp_purchase_orders').update({ total_amount: totalAfter }).eq('id', poId)
  if (tErr) return { error: `발주서 합계 갱신 실패: ${tErr.message}`, status: 500 }

  const { error: rErr } = await admin.from('erp_po_revisions').insert({
    po_id: poId, basis_send_log_id: basis.id, total_before: Math.round(totalBefore), total_after: totalAfter,
    changes, revised_by: editor.employeeId,
  })
  if (rErr) return { error: /erp_po_revisions|relation/i.test(rErr.message) ? PO_REVISE_MIGRATION_HINT : `반영 이력 저장 실패: ${rErr.message}`, status: 500 }

  // 주문 변경 이력에도 한 줄 — 주문 상세에서 무엇이 언제 맞춰졌는지 보이게
  await writeEditLogs(admin, po.order_id as string, editor, [{
    field: '발주서 수정 반영',
    before: `${po.po_no} 합계 ${won(totalBefore)}원`,
    after: `${po.po_no} 합계 ${won(totalAfter)}원 — ${reviseSummary(changes)}`,
  }])
  return { ok: true, total_before: Math.round(totalBefore), total_after: totalAfter }
}

// 반영 내용 한 줄 요약 — 주문 변경 이력 · 발주서 카드 공용
export function reviseSummary(changes: AnyRow[]): string {
  return changes.map(c => {
    const b = c.before as AnyRow | null
    const a = c.after as AnyRow | null
    if (c.action === 'remove') return `${c.po_line_no}줄 ${b?.item_name ?? ''} 빠짐`
    if (c.action === 'add') return `${c.po_line_no}줄 ${a?.item_name ?? ''} × ${a?.quantity ?? 0} 추가`
    const parts: string[] = []
    if (b && a) {
      if ((b.item_name ?? '') !== (a.item_name ?? '')) parts.push(`품명 → ${a.item_name ?? ''}`)
      if (Number(b.quantity) !== Number(a.quantity)) parts.push(`수량 ${b.quantity} → ${a.quantity}`)
      if (Number(b.purchase_price) !== Number(a.purchase_price)) parts.push(`단가 ${won(Number(b.purchase_price))} → ${won(Number(a.purchase_price))}`)
    }
    return `${c.po_line_no}줄 ${a?.item_name ?? b?.item_name ?? ''}${parts.length ? ` ${parts.join(', ')}` : ' 다시 연결'}`
  }).join(' · ')
}

// 발주서별 반영 이력 (카드 · 발송 페이지 표시용). 519 미적용이면 빈 맵
export async function loadRevisions(admin: SupabaseClient, poIds: string[]) {
  const map = new Map<string, { revised_at: string; reviser_name: string | null; summary: string; total_before: number; total_after: number }[]>()
  if (!poIds.length) return map
  const { data, error } = await admin.from('erp_po_revisions')
    .select('po_id, revised_at, total_before, total_after, changes, reviser:employees!erp_po_revisions_revised_by_fkey(name)')
    .in('po_id', poIds).order('revised_at', { ascending: false })
  if (error) return map
  for (const r of (data ?? []) as AnyRow[]) {
    const arr = map.get(r.po_id as string) ?? []
    arr.push({
      revised_at: r.revised_at as string,
      reviser_name: (r.reviser as { name?: string } | null)?.name ?? null,
      summary: reviseSummary((r.changes as AnyRow[]) ?? []),
      total_before: Number(r.total_before ?? 0), total_after: Number(r.total_after ?? 0),
    })
    map.set(r.po_id as string, arr)
  }
  return map
}
