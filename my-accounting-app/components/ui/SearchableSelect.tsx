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
}

// 거래처·계정과목처럼 옵션이 많아질 수 있는 곳에 쓰는 검색형 드롭다운.
// 트리거는 기존 <select>와 같은 자리에 들어가도록 className을 그대로 전달받고,
// 목록 패널은 position:fixed로 띄워 테이블의 overflow-x-auto에 잘리지 않게 한다.
export default function SearchableSelect({ value, onChange, options, emptyLabel, disabled, className }: Props) {
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

  const openPanel = () => {
    if (disabled) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const width = Math.max(rect.width, 220)
      const spaceBelow = window.innerHeight - rect.bottom
      const top  = spaceBelow > 280 ? rect.bottom + 4 : Math.max(8, rect.top - 4 - 280)
      const left = Math.min(rect.left, window.innerWidth - width - 8)
      setCoords({ top, left: Math.max(8, left), width })
    }
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
    const handleClose = () => setOpen(false)
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('resize', handleClose)
    window.addEventListener('scroll', handleClose, true)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('resize', handleClose)
      window.removeEventListener('scroll', handleClose, true)
    }
  }, [open])

  const handleSelect = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const total = filtered.length + 1 // +1 = emptyLabel 항목
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % total) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + total) % total) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlight === 0) handleSelect('')
      else handleSelect(filtered[highlight - 1].id)
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
              <p className="px-2.5 py-2 text-xs text-gray-400">검색 결과 없음</p>
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
