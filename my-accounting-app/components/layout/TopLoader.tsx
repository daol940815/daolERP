'use client'

// 전역 상단 진행바 — 페이지 이동 클릭 즉시 표시되어 "로딩 중"임을 알린다.
// 내부 링크 클릭을 감지해 시작하고, 경로/쿼리가 실제로 바뀌면 완료 처리한다.
// 외부 의존성 없이 CSS 트랜지션만 사용.

import { useEffect, useRef, useState, Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

function TopLoaderInner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 링크 클릭 감지 → 진행바 시작
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement)?.closest?.('a')
      if (!a) return
      const href = a.getAttribute('href')
      if (!href || href.startsWith('#') || a.target === '_blank' || a.hasAttribute('download')) return
      let url: URL
      try { url = new URL(href, window.location.href) } catch { return }
      if (url.origin !== window.location.origin) return
      // API 다운로드 링크(엑셀 등)는 페이지 이동이 아니므로 제외
      if (url.pathname.startsWith('/api/')) return
      // 같은 주소로의 클릭은 이동이 일어나지 않을 수 있음
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      setState('loading')
      // 안전장치: 10초가 지나면 자동 종료 (이동 실패·중단 대비)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setState('idle'), 10000)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  // 경로·쿼리 변경 = 이동 완료
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setState(s => (s === 'loading' ? 'done' : s))
    const t = setTimeout(() => setState('idle'), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams])

  if (state === 'idle') return null
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[3px] pointer-events-none">
      <div
        className="h-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)]"
        style={{
          width: state === 'loading' ? '85%' : '100%',
          opacity: state === 'done' ? 0 : 1,
          transition: state === 'loading'
            ? 'width 8s cubic-bezier(0.1, 0.8, 0.2, 1)'
            : 'width 0.25s ease-out, opacity 0.3s ease-out 0.15s',
        }}
      />
    </div>
  )
}

export default function TopLoader() {
  // useSearchParams는 Suspense 경계가 필요
  return (
    <Suspense fallback={null}>
      <TopLoaderInner />
    </Suspense>
  )
}
