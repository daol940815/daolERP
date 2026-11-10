'use client'

// 업무 요청 태그(업무 계열) 칩 — 테두리 알약 + 색 점 (904, 2026-11-10 시안).
//  상태 배지(긴급 · 선착 · 공동 · 진행 상태)는 칠한 사각형이라, 태그는 칠하지 않아 헷갈리지 않게 한다.
//  누를 수 있는 칩(onClick)은 선택 시 진하게, 추천(recommended)은 점선.

import { tagDotCls, tagsOf, type WrTag, type WrRow } from '@/lib/work-requests'

export function TagChip({ tag, selected, recommended, count, onClick, size = 'sm', title }: {
  tag: Pick<WrTag, 'label' | 'color'> & { active?: boolean }
  selected?: boolean; recommended?: boolean; count?: number; onClick?: () => void; size?: 'sm' | 'md'; title?: string
}) {
  const cls = `inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap leading-relaxed ${size === 'md' ? 'text-xs px-2.5 py-1' : 'text-[0.6875rem] px-2 py-px'} ${
    selected ? 'border-slate-900 bg-slate-900 text-white' : recommended ? 'border-dashed border-slate-500 bg-white text-slate-700' : 'border-gray-300 bg-white text-slate-700'
  } ${tag.active === false && !selected ? 'opacity-60' : ''} ${onClick ? 'cursor-pointer hover:border-slate-500' : ''}`
  const inner = (
    <>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tagDotCls(tag.color)} ${selected ? 'ring-1 ring-white' : ''}`} />
      {tag.label}
      {recommended && !selected && <span className="font-normal text-gray-400">추천</span>}
      {count !== undefined && <span className={`font-normal tabular-nums ${selected ? 'text-slate-300' : 'text-gray-400'}`}>{count}</span>}
    </>
  )
  return onClick
    ? <button type="button" onClick={onClick} className={cls} title={title} aria-pressed={!!selected}>{inner}</button>
    : <span className={cls} title={title}>{inner}</span>
}

// 미분류 — 태그가 없는 기존 요청 (화면 표시 · 필터 전용)
export function NoTagChip({ selected, count, onClick }: { selected?: boolean; count?: number; onClick?: () => void }) {
  const cls = `inline-flex items-center gap-1 rounded-full border border-dashed font-semibold whitespace-nowrap leading-relaxed text-[0.6875rem] px-2 py-px ${
    selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-gray-300 bg-white text-gray-400'} ${onClick ? 'cursor-pointer hover:border-slate-500' : ''}`
  const inner = <>미분류{count !== undefined && <span className={`font-normal tabular-nums ${selected ? 'text-slate-300' : 'text-gray-400'}`}>{count}</span>}</>
  return onClick ? <button type="button" onClick={onClick} className={cls} aria-pressed={!!selected}>{inner}</button> : <span className={cls}>{inner}</span>
}

// 요청 한 건의 태그 줄 (없으면 아무것도 그리지 않는다)
export function TagList({ row, tags, className = '' }: { row: Pick<WrRow, 'tag_ids'>; tags: WrTag[]; className?: string }) {
  const mine = tagsOf(row, tags)
  if (!mine.length) return null
  return <span className={`inline-flex flex-wrap gap-1 ${className}`}>{mine.map(t => <TagChip key={t.id} tag={t} title={t.active ? undefined : '숨긴 태그 — 새 요청에서는 고를 수 없습니다'} />)}</span>
}

// 태그 고르기 — 작성 · 수정 공용. 사용 중인 태그 + 이미 붙어 있던 숨김 태그. max 개를 넘기면 onLimit.
export function TagPicker({ tags, value, onChange, recommended = [], max, onLimit }: {
  tags: WrTag[]; value: string[]; onChange: (ids: string[]) => void; recommended?: string[]; max: number; onLimit?: () => void
}) {
  const options = tags.filter(t => t.active || value.includes(t.id))
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter(x => x !== id))
    else if (value.length >= max) onLimit?.()
    else onChange([...value, id])
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(t => <TagChip key={t.id} tag={t} size="md" selected={value.includes(t.id)} recommended={recommended.includes(t.id)} onClick={() => toggle(t.id)} />)}
    </div>
  )
}
