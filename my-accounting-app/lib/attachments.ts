// 공통 첨부 파일 (1200, 2026-11-11) — 화면 · 서버가 함께 쓰는 규칙. 서버 전용 판정은 lib/attachments-server.ts.
//  업로드: 브라우저 → /api/attachments (sign: 올려도 되는지 확인 + 서명 URL) → Storage 직접 업로드 → /api/attachments (confirm: 기록)
//  내려받기: /api/attachments?download=<id> 가 5분짜리 서명 URL 을 주고 브라우저가 Storage 에서 직접 받는다.
//  Vercel 서버는 파일을 만지지 않는다(본문 4.5MB 한도 무관, 서버 부담 없음).

export const ATTACH_BUCKET = 'attachments'
export const ATTACH_MAX_BYTES = 10 * 1024 * 1024        // 사진이 아닌 파일 1개 상한 (버킷 file_size_limit 과 같다)
export const ATTACH_MAX_PER_OWNER = 10                  // 한 건(업무 요청 1건 등)에 붙일 수 있는 파일 수
export const ATTACH_IMAGE_LONG_SIDE = 1600              // 사진 자동 축소 — 긴 변 px
export const ATTACH_IMAGE_QUALITY = 0.85
export const STORAGE_FREE_BYTES = 1024 * 1024 * 1024    // Supabase 무료 플랜 파일 저장 한도 1GB (마스터 화면 표시용)

// 쓰는 곳 — 새 화면이 첨부를 쓰려면 여기와 lib/attachments-server.ts 의 ATTACHMENT_OWNERS 에 함께 등록한다.
export const ATTACH_OWNER_LABEL: Record<string, string> = {
  work_request: '업무 요청',
}
export type AttachOwnerType = keyof typeof ATTACH_OWNER_LABEL

// 받는 형식 — 확장자로 판정(한글 hwp 등은 브라우저가 형식을 비워 보내는 경우가 많다)
export const ATTACH_EXTS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp',
  'pdf', 'xls', 'xlsx', 'csv', 'doc', 'docx', 'ppt', 'pptx', 'hwp', 'hwpx', 'txt', 'zip',
]
export const ATTACH_ACCEPT = ATTACH_EXTS.map(e => `.${e}`).join(',')
export const extOf = (name: string) => (name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? '').toLowerCase()
export const isAllowedFile = (name: string) => ATTACH_EXTS.includes(extOf(name))
export const isImageName = (name: string) => ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif'].includes(extOf(name))

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`
}

export interface AttachmentItem {
  id: string
  file_name: string
  mime: string | null
  size_bytes: number
  width: number | null
  height: number | null
  created_at: string
  uploader: { id: string; name: string } | null
  can_delete: boolean
  preview_url: string | null      // 사진이면 10분짜리 서명 URL (미리보기)
}

// ── 브라우저 전용: 사진 자동 축소 ──
//  긴 변이 1600px 을 넘거나 1MB 를 넘는 사진(jpg · png · webp · bmp)을 JPEG 로 다시 그린다. gif(움직임) · heic(브라우저가 못 여는 경우)는 그대로.
//  읽기에 실패하면 원본을 그대로 쓴다(그때는 10MB 상한이 적용된다).
export async function shrinkImage(file: File): Promise<{ file: File; width: number | null; height: number | null }> {
  const ext = extOf(file.name)
  if (!['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext)) return { file, width: null, height: null }
  try {
    const bmp = await createImageBitmap(file)
    const { width: w0, height: h0 } = bmp
    const scale = Math.min(1, ATTACH_IMAGE_LONG_SIDE / Math.max(w0, h0))
    if (scale === 1 && file.size <= 1024 * 1024) { bmp.close(); return { file, width: w0, height: h0 } }
    const w = Math.round(w0 * scale), h = Math.round(h0 * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bmp.close(); return { file, width: w0, height: h0 } }
    ctx.fillStyle = '#ffffff'   // 투명 PNG 의 배경 (JPEG 는 투명을 못 담는다)
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', ATTACH_IMAGE_QUALITY))
    if (!blob || blob.size >= file.size) return { file, width: w0, height: h0 }   // 줄여도 커지면 원본
    const base = file.name.replace(/\.[A-Za-z0-9]+$/, '')
    return { file: new File([blob], `${base}.jpg`, { type: 'image/jpeg' }), width: w, height: h }
  } catch {
    return { file, width: null, height: null }
  }
}
