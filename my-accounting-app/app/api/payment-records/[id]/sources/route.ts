import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { loadCollectCandidates, type OrderCollectSummary } from '@/lib/erp-order-collect'
import { loadCardKinds, loadRecKinds } from '@/lib/payment-records'
import { kindDiff, kindLabel } from '@/lib/payment-kind'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// "다른 입금 찾기" — 결제 기록 1건에 붙일 원본(통장 입금 · 카드 매출)을 직접 검색
//   GET ?from=&to=&amount=&card4=&q=   (기본: 결제일 −7일부터, 금액은 기록 금액)
// 카드 매출 후보에는 원본 구분(kind)과 기록한 구분과의 차이(kind_diff)를 붙인다 — 화면이 다른 구분을 접어 둔다(1304, 2026-11-18).
// 검색은 주문 쪽 수금 매칭과 같은 로직(lib/erp-order-collect.ts)을 쓴다.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const { data: rec, error } = await admin.from('order_payment_records')
    .select('id, pay_date, amount, vendor_id').eq('id', params.id).maybeSingle()
  if (error || !rec) return NextResponse.json({ error: '결제 기록을 찾을 수 없습니다.' }, { status: 404 })
  const sp = new URL(req.url).searchParams
  const d = new Date(String(rec.pay_date) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 7)
  const amountRaw = sp.get('amount')
  const pseudo = { order_date: rec.pay_date, remaining: Number(rec.amount), vendor_id: rec.vendor_id } as unknown as OrderCollectSummary
  const r = await loadCollectCandidates(admin, pseudo, {
    scope: 'all',
    from: sp.get('from') || d.toISOString().slice(0, 10), to: sp.get('to'),
    amount: amountRaw === '' ? null : amountRaw ? Number(amountRaw.replace(/,/g, '')) : Number(rec.amount),
    card4: sp.get('card4'), q: sp.get('q'),
  })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  const myKind = (await loadRecKinds(admin, [params.id]))?.get(params.id) ?? null
  const cardKinds = await loadCardKinds(admin, r.data.filter(c => c.source_type === 'card').map(c => c.id))
  return NextResponse.json({
    candidates: r.data.map(c => {
      const sk = c.source_type === 'card' ? cardKinds.get(c.id) : undefined
      return { ...c, kind: c.source_type === 'card' ? kindLabel(sk) : null, kind_diff: !!sk && kindDiff(myKind, sk).length > 0 }
    }),
  })
}
