import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase-server'
import { postJournal, unpostJournal } from '@/lib/journal/posting'
import type { JournalDraft, JournalLineDraft } from '@/lib/journal/types'

export const dynamic = 'force-dynamic'

// POST /api/journal/manual
// 수동 분개 생성. body: { entry_date, description, entry_type?, lines:[{account_id, side, amount, vendor_id?, note?}] }
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as {
    entry_date?: string
    description?: string | null
    entry_type?: 'normal' | 'adjustment' | 'closing'
    lines?: { account_id?: string; side?: string; amount?: number; vendor_id?: string | null; note?: string | null }[]
  }

  if (!body.entry_date) return NextResponse.json({ error: '전표일자가 필요합니다.' }, { status: 400 })
  const rawLines = Array.isArray(body.lines) ? body.lines : []
  if (rawLines.length < 2) return NextResponse.json({ error: '분개 라인은 최소 2개입니다.' }, { status: 400 })

  const lines: JournalLineDraft[] = []
  for (const l of rawLines) {
    if (!l.account_id) return NextResponse.json({ error: '계정과목이 비어있는 라인이 있습니다.' }, { status: 400 })
    if (l.side !== 'debit' && l.side !== 'credit') return NextResponse.json({ error: '차변/대변 구분이 올바르지 않습니다.' }, { status: 400 })
    const amount = Math.trunc(Number(l.amount ?? 0))
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: '금액은 0보다 커야 합니다.' }, { status: 400 })
    lines.push({ account_id: l.account_id, side: l.side, amount, vendor_id: l.vendor_id ?? null, note: l.note ?? null })
  }

  const debit = lines.filter(l => l.side === 'debit').reduce((s, l) => s + l.amount, 0)
  const credit = lines.filter(l => l.side === 'credit').reduce((s, l) => s + l.amount, 0)
  if (debit !== credit) {
    return NextResponse.json({ error: `차변(${debit.toLocaleString()}) ≠ 대변(${credit.toLocaleString()})` }, { status: 400 })
  }

  const draft: JournalDraft = {
    source_type: 'manual',
    source_id: randomUUID(),
    entry_date: body.entry_date,
    description: body.description?.trim() || null,
    entry_type: body.entry_type ?? 'normal',
    lines,
  }
  const res = await postJournal(admin, draft)
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: 500 })
  return NextResponse.json({ ok: true, entry_id: res.id, source_id: draft.source_id })
}

// DELETE /api/journal/manual?sourceId=...  (수동 분개만 삭제)
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const sourceId = new URL(req.url).searchParams.get('sourceId')
  if (!sourceId) return NextResponse.json({ error: 'sourceId가 필요합니다.' }, { status: 400 })

  // 안전장치: manual 출처만 삭제 허용
  const { data: e } = await admin
    .from('journal_entries')
    .select('source_type')
    .eq('source_type', 'manual')
    .eq('source_id', sourceId)
    .maybeSingle()
  if (!e) return NextResponse.json({ error: '수동 분개를 찾을 수 없습니다.' }, { status: 404 })

  const r = await unpostJournal(admin, 'manual', sourceId)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
