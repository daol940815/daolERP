import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

// 결제정보 암호화 (상담일지 — 사용자 확정: 평문 입력, 암호화 저장, 화면 마스킹)
// AES-256-GCM. 키는 PAYMENT_ENC_KEY 환경변수에서 파생 (sha256).
// 저장 형식: base64(iv).base64(tag).base64(cipher)
//
// 주의: PAYMENT_ENC_KEY를 바꾸면 기존 암호문을 복호화할 수 없다 — 변경 금지.
// Vercel 환경변수(Production·Preview)와 .env.local에 동일 값 설정 필요.

const keyOf = (): Buffer | null => {
  const secret = process.env.PAYMENT_ENC_KEY
  if (!secret) return null
  return createHash('sha256').update(secret).digest()
}

export const encryptionReady = () => !!process.env.PAYMENT_ENC_KEY

export function encryptPayment(plain: string): string | null {
  const key = keyOf()
  if (!key) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`
}

export function decryptPayment(stored: string): string | null {
  const key = keyOf()
  if (!key) return null
  try {
    const [ivB64, tagB64, encB64] = stored.split('.')
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return null   // 키 불일치·손상 — 화면에는 복호화 실패로 표시
  }
}

// 마스킹: 숫자 4자리 초과 구간을 가리되 앞 4·뒤 4는 남긴다.
// "9450-8190-0195-3145" → "9450-****-****-3145"
export function maskPayment(plain: string): string {
  const digits = plain.replace(/\D/g, '')
  if (digits.length <= 8) return plain.replace(/\d/g, '*')
  let idx = 0
  return plain.replace(/\d/g, d => {
    idx += 1
    return idx <= 4 || idx > digits.length - 4 ? d : '*'
  })
}
