'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'

interface SourceDetail {
  title: string
  fields: { label: string; value: string }[]
  link: { href: string; label: string } | null
}

// 분개 원본 레코드 상세 — 추적성(Drill-down)의 종점 (회계정책 §6)
// 원장 행의 [원본] 링크로 진입한다. 읽기 전용.
export default function SourceDetailPage() {
  const { type, id } = useParams<{ type: string; id: string }>()
  const router = useRouter()
  const [data, setData] = useState<SourceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/source/${type}/${id}`, { cache: 'no-store' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (ok) setData(j); else setError(j.error ?? '조회 실패') })
      .catch(() => setError('네트워크 오류'))
  }, [type, id])

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600 mb-3">← 돌아가기</button>
      {error ? (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>
      ) : !data ? (
        <p className="text-gray-400 text-sm py-10 text-center">불러오는 중...</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h1 className="text-xl font-bold text-gray-900 mb-4">{data.title} <span className="text-xs font-normal text-gray-400">원본 레코드</span></h1>
          <dl className="divide-y divide-gray-100">
            {data.fields.map((f, i) => (
              <div key={i} className="py-2.5 flex gap-4">
                <dt className="w-32 shrink-0 text-sm text-gray-400">{f.label}</dt>
                <dd className="text-sm text-gray-900 break-all">{f.value}</dd>
              </div>
            ))}
          </dl>
          {data.link && (
            <Link href={data.link.href} className="inline-block mt-5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
              {data.link.label} →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
