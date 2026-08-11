import ConsultForm from '../consult-form'

// 상담일지 상세·수정 (주문 전환된 상담은 읽기 전용)
export default function ConsultationDetailPage({ params }: { params: { id: string } }) {
  return <ConsultForm consultId={params.id} />
}
