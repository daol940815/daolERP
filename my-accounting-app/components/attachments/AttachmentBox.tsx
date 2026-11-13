'use client'

// 공통 첨부 부품 (1200, 2026-11-11) — 업무 요청 등 어느 화면이든 이것 하나로 붙인다.
//  <AttachmentBox ownerType="work_request" ownerId={id} />          — 저장된 건 (권한은 API 가 판정해 can_add · can_delete 로 내려줌)
//  <AttachmentBox ownerType="work_request" draftKey={uuid} />       — 저장 전 작성 화면. 저장 API 에 draft_key 를 넘기면 연결된다.
//  파일 선택 · 끌어놓기 · 붙여넣기(Ctrl+V 화면 캡처) 모두 받는다. 사진은 올리기 전에 긴 변 1600px 로 줄인다.
//  파일은 브라우저 → Storage 로 직접 간다(서버 경유 없음).

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import {
  ATTACH_BUCKET, ATTACH_ACCEPT, ATTACH_MAX_BYTES, ATTACH_MAX_PER_OWNER, ATTACH_IMAGE_LONG_SIDE,
  isAllowedFile, isImageName, extOf, fmtBytes, shrinkImage, type AttachmentItem,
} from '@/lib/attachments'

interface Props {
  ownerType: string
  ownerId?: string | null
  draftKey?: string | null
  title?: string
  pasteAnywhere?: boolean      // 화면 어디서든 Ctrl+V 로 붙인 사진 · 파일을 받는다 (글자 붙여넣기는 그대로)
  onCountChange?: (n: number) => void
  className?: string
}

export default function AttachmentBox({ ownerType, ownerId, draftKey, title = '첨부 파일', pasteAnywhere, onCountChange, className = '' }: Props) {
  const [items, setItems] = useState<AttachmentItem[]>([])
  const [canAdd, setCanAdd] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [uploading, setUploading] = useState<string[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const target = ownerId ? `owner_id=${ownerId}` : draftKey ? `draft_key=${draftKey}` : ''

  const load = useCallback(async () => {
    if (!target) return
    const res = await fetch(`/api/attachments?owner_type=${ownerType}&${target}`, { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    setLoaded(true)
    if (!res.ok) { setMsg(j.error ?? '첨부 목록을 불러오지 못했습니다.'); return }
    setItems(j.items ?? []); setCanAdd(!!j.can_add); setHint(j.hint ?? null)
  }, [ownerType, target])
  useEffect(() => { load() }, [load])
  useEffect(() => { onCountChange?.(items.length) }, [items.length, onCountChange])

  const ownerBody = ownerId ? { owner_type: ownerType, owner_id: ownerId } : { owner_type: ownerType, draft_key: draftKey }

  const uploadOne = async (raw: File): Promise<string | null> => {
    const name = raw.name || `붙여넣은_사진_${Date.now()}.png`
    const src = raw.name ? raw : new File([raw], name, { type: raw.type })
    if (!isAllowedFile(name)) return `${name}: 올릴 수 없는 형식입니다.`
    const { file, width, height } = isImageName(name) ? await shrinkImage(src) : { file: src, width: null, height: null }
    if (file.size > ATTACH_MAX_BYTES) return `${name}: ${fmtBytes(ATTACH_MAX_BYTES)}를 넘습니다(${fmtBytes(file.size)}). 큰 파일은 회사 서버에 두고 링크로 남겨주세요.`
    const post = (b: Record<string, unknown>) => fetch('/api/attachments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ownerBody, ...b }) })
      .then(async r => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
    const s = await post({ action: 'sign', file_name: file.name, size: file.size })
    if (!s.ok) return `${name}: ${s.j.error ?? '업로드 준비 실패'}`
    const up = await createClient().storage.from(ATTACH_BUCKET).uploadToSignedUrl(s.j.path, s.j.token, file, { contentType: file.type || 'application/octet-stream' })
    if (up.error) return `${name}: 업로드 실패 (${up.error.message})`
    const c = await post({ action: 'confirm', path: s.j.path, file_name: file.name, mime: file.type, width, height })
    if (!c.ok) return `${name}: ${c.j.error ?? '기록 실패'}`
    return null
  }

  const addFiles = async (files: File[]) => {
    if (!files.length) return
    setMsg(null)
    const room = ATTACH_MAX_PER_OWNER - items.length
    if (room <= 0) { setMsg(`한 건에 ${ATTACH_MAX_PER_OWNER}개까지 붙일 수 있습니다.`); return }
    const list = files.slice(0, room)
    const errors: string[] = files.length > room ? [`${files.length - room}개는 개수 상한(${ATTACH_MAX_PER_OWNER}개)을 넘어 빠졌습니다.`] : []
    setUploading(list.map(f => f.name || '붙여넣은 사진'))
    for (const f of list) {   // 순서대로 — 동시에 올리면 개수 상한 판정이 어긋난다
      const e = await uploadOne(f)
      if (e) errors.push(e)
      setUploading(u => u.slice(1))
    }
    setUploading([])
    if (errors.length) setMsg(errors.join('\n'))
    await load()
  }

  // 화면 어디서든 붙여넣기 — 파일이 들어 있을 때만 가로챈다
  useEffect(() => {
    if (!pasteAnywhere || !canAdd) return
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (!files.length) return
      e.preventDefault()
      addFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })   // addFiles 가 최신 items 를 보도록 매 렌더 다시 건다

  const download = async (a: AttachmentItem, inline = false) => {
    const res = await fetch(`/api/attachments?download=${a.id}${inline ? '&inline=1' : ''}`, { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j.url) { setMsg(j.error ?? '내려받기 실패'); return }
    if (inline) window.open(j.url, '_blank', 'noopener'); else window.location.href = j.url
  }
  const remove = async (a: AttachmentItem) => {
    if (!window.confirm(`"${a.file_name}" 파일을 지울까요? 지운 파일은 되살릴 수 없습니다.`)) return
    const res = await fetch(`/api/attachments?id=${a.id}`, { method: 'DELETE' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setMsg(j.error ?? '삭제 실패'); return }
    await load()
  }

  if (!target) return null
  if (loaded && hint) return <div className={`text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 ${className}`}>{hint}</div>
  if (loaded && !items.length && !canAdd) return null   // 볼 것도 붙일 수도 없으면 자리를 차지하지 않는다

  const images = items.filter(a => isImageName(a.file_name) && a.preview_url)
  const files = items.filter(a => !images.includes(a))
  const busy = uploading.length > 0

  return (
    <div className={className}
      onDragOver={e => { if (canAdd) { e.preventDefault(); setDrag(true) } }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { if (!canAdd) return; e.preventDefault(); setDrag(false); addFiles(Array.from(e.dataTransfer.files)) }}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-xs font-medium text-gray-600">{title}{items.length ? ` ${items.length}개` : ''}</span>
        {canAdd && <span className="text-[0.6875rem] text-gray-400">사진은 긴 변 {ATTACH_IMAGE_LONG_SIDE}px 로 자동 축소 · 그 밖의 파일은 1개 {fmtBytes(ATTACH_MAX_BYTES)}까지 · 최대 {ATTACH_MAX_PER_OWNER}개</span>}
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
          {images.map(a => (
            <div key={a.id} className="relative group border border-gray-200 rounded-lg overflow-hidden bg-slate-50">
              <button type="button" onClick={() => download(a, true)} className="block w-full aspect-square" title={`${a.file_name} · ${fmtBytes(a.size_bytes)}${a.uploader ? ` · ${a.uploader.name}` : ''}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.preview_url!} alt={a.file_name} className="w-full h-full object-cover" loading="lazy" />
              </button>
              <div className="absolute inset-x-0 bottom-0 bg-white/90 px-1.5 py-0.5 flex items-center gap-1 text-[0.625rem] text-gray-600">
                <span className="truncate flex-1">{a.uploader?.name ?? ''} · {fmtBytes(a.size_bytes)}</span>
                <button type="button" onClick={() => download(a)} className="hover:text-gray-900 underline">받기</button>
                {a.can_delete && <button type="button" onClick={() => remove(a)} className="text-red-600 hover:underline">삭제</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <ul className="mt-2 divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {files.map(a => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="text-[0.625rem] font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">{extOf(a.file_name) || '파일'}</span>
              <button type="button" onClick={() => download(a)} className="truncate text-left text-gray-800 hover:underline flex-1" title="내려받기">{a.file_name}</button>
              <span className="text-xs text-gray-400 whitespace-nowrap">{fmtBytes(a.size_bytes)}{a.uploader ? ` · ${a.uploader.name}` : ''}</span>
              {a.can_delete && <button type="button" onClick={() => remove(a)} className="text-xs text-red-600 hover:underline">삭제</button>}
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
        <div className={`mt-2 border border-dashed rounded-lg px-3 py-3 text-center text-xs ${drag ? 'border-slate-900 bg-slate-50' : 'border-gray-300'}`}>
          <input ref={inputRef} type="file" multiple accept={ATTACH_ACCEPT} className="hidden"
            onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; addFiles(f) }} />
          {busy ? (
            <span className="text-gray-600">올리는 중… {uploading[0]}{uploading.length > 1 ? ` 외 ${uploading.length - 1}개` : ''}</span>
          ) : (
            <span className="text-gray-500">
              <button type="button" onClick={() => inputRef.current?.click()} className="px-2.5 py-1 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 mr-2">파일 선택</button>
              여기로 끌어놓거나{pasteAnywhere ? ' 화면 캡처를 Ctrl+V 로 붙여넣으세요' : ' 파일을 선택하세요'}
            </span>
          )}
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-red-600 whitespace-pre-line">{msg}</p>}
    </div>
  )
}
