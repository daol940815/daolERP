import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildContactManagerBundle } from '@/lib/contact-manager'

export const dynamic = 'force-dynamic'

// GET /api/contact-manager            — 목록 번들 (담당자·공백 거래처·미확인 큐·KPI)
// GET /api/contact-manager?search_vendor=하나 — 거래처 검색 (이동 처리·후임 지정용)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const q = req.nextUrl.searchParams.get('search_vendor')?.trim()
  if (q) {
    const { data, error } = await admin
      .from('vendors').select('id, name')
      .in('type', ['customer', 'both']).neq('status', 'merged')
      .ilike('name', `%${q}%`).order('name').limit(20)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ vendors: data ?? [] })
  }
  const bundle = await buildContactManagerBundle(admin)
  if ('error' in bundle) return NextResponse.json({ error: bundle.error }, { status: 500 })
  return NextResponse.json(bundle)
}

// POST /api/contact-manager — 담당자 관리 액션 모음
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body?.action) return NextResponse.json({ error: 'action이 필요합니다.' }, { status: 400 })
  const action = body.action as string
  const today = new Date().toISOString().slice(0, 10)

  try {
    switch (action) {
      // 인물 정보 수정
      case 'update_contact': {
        const { contact_id, name, phone, email, note } = body as {
          contact_id: string; name?: string; phone?: string; email?: string; note?: string }
        if (!contact_id) return bad('contact_id가 필요합니다.')
        const patch: Record<string, string | null> = {}
        if (name !== undefined) {
          if (!name.trim()) return bad('이름은 비울 수 없습니다.')
          patch.name = name.trim()
        }
        if (phone !== undefined) patch.phone = phone.trim() || null
        if (email !== undefined) patch.email = email.trim() || null
        if (note !== undefined) patch.note = note.trim() || null
        const { error } = await admin.from('contacts').update(patch).eq('id', contact_id)
        if (error) throw error
        return ok()
      }

      // 신규 인물 (+선택 배정) — 미확인 큐 '신규 인물'과 공백 거래처 '담당자 등록' 겸용
      case 'create_contact': {
        const { name, phone, title, vendor_id, raw_name } = body as {
          name: string; phone?: string; title?: string; vendor_id?: string; raw_name?: string }
        if (!name?.trim()) return bad('이름이 필요합니다.')
        const { data: c, error } = await admin.from('contacts')
          .insert({ name: name.trim(), phone: phone?.trim() || null }).select('id').single()
        if (error || !c) throw error ?? new Error('생성 실패')
        if (vendor_id) {
          const { error: ae } = await admin.from('contact_assignments')
            .insert({ contact_id: c.id, vendor_id, title: title?.trim() || null, started_at: today })
          if (ae) throw ae
          // 주문 표기와 함께 온 경우 명시 연결도 기록 (오타 등 포함 관계가 아니어도 귀속되도록)
          if (raw_name?.trim()) {
            await admin.from('contact_name_links')
              .upsert({ vendor_id, raw_name: raw_name.trim(), contact_id: c.id },
                      { onConflict: 'vendor_id,raw_name' })
          }
        }
        return NextResponse.json({ ok: true, contact_id: c.id })
      }

      // 기존 인물을 거래처에 배정 (공백 거래처 후임 지정)
      case 'assign': {
        const { contact_id, vendor_id, title, is_representative } = body as {
          contact_id: string; vendor_id: string; title?: string; is_representative?: boolean }
        if (!contact_id || !vendor_id) return bad('contact_id, vendor_id가 필요합니다.')
        if (is_representative) {
          const { error: ue } = await admin.from('contact_assignments')
            .update({ is_representative: false })
            .eq('vendor_id', vendor_id).eq('is_representative', true).is('ended_at', null)
          if (ue) throw ue
        }
        const { error } = await admin.from('contact_assignments').insert({
          contact_id, vendor_id, title: title?.trim() || null,
          is_representative: !!is_representative, started_at: today })
        if (error) throw error
        return ok()
      }

      // 이동 처리: 현재 배정 전부 종료 + 새 거래처 배정
      case 'move': {
        const { contact_id, to_vendor_id, title } = body as {
          contact_id: string; to_vendor_id: string; title?: string }
        if (!contact_id || !to_vendor_id) return bad('contact_id, to_vendor_id가 필요합니다.')
        const { error: ee } = await admin.from('contact_assignments')
          .update({ ended_at: today, is_representative: false })
          .eq('contact_id', contact_id).is('ended_at', null)
        if (ee) throw ee
        const { error } = await admin.from('contact_assignments')
          .insert({ contact_id, vendor_id: to_vendor_id, title: title?.trim() || null, started_at: today })
        if (error) throw error
        return ok()
      }

      // 배정 종료 (퇴직 등 — 새 소속 없음)
      case 'end_assignment': {
        const { assignment_id } = body as { assignment_id: string }
        if (!assignment_id) return bad('assignment_id가 필요합니다.')
        const { error } = await admin.from('contact_assignments')
          .update({ ended_at: today, is_representative: false }).eq('id', assignment_id)
        if (error) throw error
        return ok()
      }

      // 대표 담당자 지정
      case 'set_representative': {
        const { assignment_id, vendor_id } = body as { assignment_id: string; vendor_id: string }
        if (!assignment_id || !vendor_id) return bad('assignment_id, vendor_id가 필요합니다.')
        const { error: ue } = await admin.from('contact_assignments')
          .update({ is_representative: false })
          .eq('vendor_id', vendor_id).eq('is_representative', true).is('ended_at', null)
        if (ue) throw ue
        const { error } = await admin.from('contact_assignments')
          .update({ is_representative: true }).eq('id', assignment_id)
        if (error) throw error
        return ok()
      }

      // 동명이인 병합: source의 배정·일지·연결을 target으로 이전
      case 'merge': {
        const { source_id, target_id } = body as { source_id: string; target_id: string }
        if (!source_id || !target_id || source_id === target_id) return bad('병합 대상이 올바르지 않습니다.')
        for (const t of ['contact_assignments', 'contact_activities', 'contact_name_links'] as const) {
          const { error } = await admin.from(t).update({ contact_id: target_id }).eq('contact_id', source_id)
          // 105 미적용 테이블은 건너뜀
          if (error && !/contact_activities|contact_name_links/.test(error.message)) throw error
        }
        const { error } = await admin.from('contacts')
          .update({ merged_into_id: target_id }).eq('id', source_id)
        if (error) throw error
        return ok()
      }

      // 미확인 담당자명: 기존 인물에 연결 (배정 없으면 배정도 생성)
      case 'link_name': {
        const { vendor_id, raw_name, contact_id, title } = body as {
          vendor_id: string; raw_name: string; contact_id: string; title?: string }
        if (!vendor_id || !raw_name?.trim() || !contact_id) return bad('vendor_id, raw_name, contact_id가 필요합니다.')
        const { data: exist, error: qe } = await admin.from('contact_assignments')
          .select('id').eq('vendor_id', vendor_id).eq('contact_id', contact_id).is('ended_at', null).limit(1)
        if (qe) throw qe
        if (!exist?.length) {
          const { error: ae } = await admin.from('contact_assignments')
            .insert({ contact_id, vendor_id, title: title?.trim() || null, started_at: today })
          if (ae) throw ae
        }
        const { error } = await admin.from('contact_name_links')
          .upsert({ vendor_id, raw_name: raw_name.trim(), contact_id }, { onConflict: 'vendor_id,raw_name' })
        if (error) throw error
        return ok()
      }

      // 미확인 담당자명: 무시 (비인명 표기 공란 처리)
      case 'ignore_name': {
        const { vendor_id, raw_name } = body as { vendor_id: string; raw_name: string }
        if (!vendor_id || !raw_name?.trim()) return bad('vendor_id, raw_name이 필요합니다.')
        const { error } = await admin.from('contact_name_links')
          .upsert({ vendor_id, raw_name: raw_name.trim(), contact_id: null }, { onConflict: 'vendor_id,raw_name' })
        if (error) throw error
        return ok()
      }

      // 영업일지 기록
      case 'add_activity': {
        const { contact_id, vendor_id, employee_id, activity_date, activity_type, content, next_action } = body as {
          contact_id: string; vendor_id?: string; employee_id?: string
          activity_date?: string; activity_type?: string; content: string; next_action?: string }
        if (!contact_id || !content?.trim()) return bad('contact_id, content가 필요합니다.')
        const { error } = await admin.from('contact_activities').insert({
          contact_id,
          vendor_id: vendor_id || null,
          employee_id: employee_id || null,
          activity_date: activity_date || today,
          activity_type: activity_type || '기타',
          content: content.trim(),
          next_action: next_action?.trim() || null,
        })
        if (error) throw error
        return ok()
      }

      default:
        return bad(`알 수 없는 action: ${action}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/contact_activities|contact_name_links/.test(msg)) {
      return NextResponse.json({ error: '마이그레이션 105(contact_manager)가 아직 실행되지 않았습니다. SQL 편집기에서 105_contact_manager.sql을 실행해 주세요.' }, { status: 400 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

const ok = () => NextResponse.json({ ok: true })
const bad = (m: string) => NextResponse.json({ error: m }, { status: 400 })
