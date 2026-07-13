'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useGridCellEditor } from 'ag-grid-react'
import type { CustomCellEditorProps } from 'ag-grid-react'

interface Props extends CustomCellEditorProps<unknown, string> {
  values: string[]
}

export default function SearchableCellEditor(props: Props) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useGridCellEditor({
    isCancelAfterEnd: () => false,
  })

  useEffect(() => { inputRef.current?.focus() }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return props.values
    return props.values.filter(v => v.toLowerCase().includes(q))
  }, [props.values, query])

  const handlePick = (v: string) => {
    props.onValueChange(v)
    props.stopEditing()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % Math.max(filtered.length, 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlight]) handlePick(filtered[highlight]) }
    else if (e.key === 'Escape') { e.preventDefault(); props.stopEditing(true) }
  }

  return (
    <div className="bg-white border border-gray-300 rounded-lg shadow-lg w-56">
      <input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); setHighlight(0) }}
        onKeyDown={handleKeyDown}
        placeholder="검색..."
        className="w-full px-2.5 py-1.5 text-xs border-b border-gray-200 focus:outline-none rounded-t-lg"
      />
      <div className="max-h-60 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-gray-400">검색 결과 없음</p>
        ) : filtered.map((v, i) => (
          <button
            key={v}
            type="button"
            onClick={() => handlePick(v)}
            className={`w-full text-left px-2.5 py-1.5 text-xs truncate ${i === highlight ? 'bg-slate-100' : 'hover:bg-gray-50'} ${v === props.value ? 'font-medium text-slate-900' : 'text-gray-700'}`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  )
}
