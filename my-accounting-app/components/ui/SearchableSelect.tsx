'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

export interface SearchableSelectOption {
  id: string
  label: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  options: SearchableSelectOption[]
  emptyLabel: string
  disabled?: boolean
  className?: string
  // 검색 결과가 하나도 없을 때 입력한 검색어로 새 항목을 만들 수 있게 하는 콜백 (거래처 즉시 등록 등)
  onCreateNew?: (query: string) => void
  createNewLabel?: (query: string) => string
}

// 거래처·계정과목처럼 옵션이 많아질 수 있는 곳에 쓰는 검색형 드롭다운.
// 트리거는 기존 <select>와 같은 자리에 들어가도록 className을 그대로 전달받고,
// 목록 패널은 position:fixed로 띄워 테이블의 overflow-x-auto에 잘리지 않게 한다.
export default function SearchableSelect({ value, onChange, options, emptyLabel, disabled, className, onCreateNew, createNewLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const panelRef   = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.id === value) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.label.toLowerCase().includes(q))
  }, [options, query])

  // 트리거 위치 기준으로 패널 좌표 계산. 트리거가 화면 밖이면 null(→ 닫기).
  const place = (): { top: number; left: number; width: number } | null => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return null
    if (rect.bottom < 0 || rect.top > window.innerHeight) return null
    const width = Math.max(rect.width, 220)
    const spaceBelow = window.innerHeight - rect.bottom
    const top  = spaceBelow > 280 ? rect.bottom + 4 : Math.max(8, rect.top - 4 - 280)
    const left = Math.min(rect.left, window.innerWidth - width - 8)
    return { top, left: Math.max(8, left), width }
  }

  const openPanel = () => {
    if (disabled) return
    setCoords(place())
    setQuery('')
    setHighlight(0)
    setOpen(true)
  }

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return
      if (triggerRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    // 스크롤/리사이즈 시 닫지 않고 위치만 갱신(따라가기). 단, 패널 내부(옵션 목록) 스크롤은 무시.
    const reposition = (e?: Event) => {
      if (e && panelRef.current?.contains(e.target as Node)) return
      const c = place()
      if (!c) { setOpen(false); return }  // 트리거가 화면 밖으로 나가면 닫기
      setCoords(c)
    }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  const handleSelect = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  const showCreate = !!onCreateNew && query.trim().length > 0 && filtered.length === 0

  const handleCreate = () => {
    if (!onCreateNew) return
    onCreateNew(query.trim())
    setOpen(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const total = filtered.length + 1 + (showCreate ? 1 : 0) // +1 = emptyLabel 항목
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % total) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + total) % total) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlight === 0) handleSelect('')
      else if (highlight <= filtered.length) handleSelect(filtered[highlight - 1].id)
      else if (showCreate) handleCreate()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={`text-left truncate disabled:opacity-50 ${className ?? ''}`}
      >
        {selected ? selected.label : emptyLabel}
      </button>
      {open && coords && (
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width, zIndex: 50 }}
          className="bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
        >
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setHighlight(0) }}
            onKeyDown={handleKeyDown}
            placeholder="검색..."
            className="w-full px-2.5 py-1.5 text-xs border-b border-gray-200 focus:outline-none"
          />
          <div className="max-h-60 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => handleSelect('')}
              className={`w-full text-left px-2.5 py-1.5 text-xs ${highlight === 0 ? 'bg-slate-100' : 'hover:bg-gray-50'} ${!value ? 'text-gray-400' : 'text-gray-700'}`}
            >
              {emptyLabel}
            </button>
            {filtered.length === 0 ? (
              showCreate ? (
                <button
                  type="button"
                  onClick={handleCreate}
                  className={`w-full text-left px-2.5 py-1.5 text-xs ${highlight === 1 ? 'bg-emerald-100' : 'hover:bg-emerald-50'} text-emerald-700`}
                >
                  {createNewLabel ? createNewLabel(query.trim()) : `+ '${query.trim()}' 새로 추가`}
                </button>
              ) : (
                <p className="px-2.5 py-2 text-xs text-gray-400">검색 결과 없음</p>
              )
            ) : filtered.map((o, i) => (
              <button
                key={o.id}
                type="button"
                onClick={() => handleSelect(o.id)}
                className={`w-full text-left px-2.5 py-1.5 text-xs truncate ${highlight === i + 1 ? 'bg-slate-100' : 'hover:bg-gray-50'} ${o.id === value ? 'font-medium text-slate-900' : 'text-gray-700'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
