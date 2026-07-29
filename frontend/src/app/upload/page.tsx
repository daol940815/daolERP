import MainLayout from '@/components/layout/MainLayout'
import UploadForm from '@/components/features/upload/UploadForm'

export default function UploadPage() {
  return (
    <MainLayout>
      <div className="space-y-4">
        <h1 className="text-base font-semibold text-slate-200">파일 업로드</h1>
        <p className="text-sm text-slate-500">
          은행/카드사 거래내역 엑셀 파일을 업로드하면 자동으로 파싱하여 저장합니다.
          중복 거래는 hash key로 자동 감지됩니다.
        </p>
        <UploadForm />
      </div>
    </MainLayout>
  )
}
