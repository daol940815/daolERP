import ConsultForm from '../consult-form'

// 상담 기록 작성.
// ?copy=<상담id>&lines=1,3 — 목록 "선택 복사": 원본 상담의 선택 품목으로 프리필.
export default function NewConsultationPage({ searchParams }: {
  searchParams?: { copy?: string; lines?: string }
}) {
  const copyId = searchParams?.copy || undefined
  const copyLines = (searchParams?.lines ?? '')
    .split(',').map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n > 0)
  return <ConsultForm copyId={copyId} copyLines={copyLines} />
}
