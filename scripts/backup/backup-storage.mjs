#!/usr/bin/env node
// Supabase Storage 파일 전체를 내려받는다(첨부 · 발주서 첨부 · 명단 등 모든 버킷).
// 목록은 dump-db.sh 가 만든 storage-objects.json(storage.objects 원본)을 쓴다 — DB 덤프와 같은 시점 기준.
// 사용: node backup-storage.mjs <objects.json> <저장 폴더>
// 환경변수: SUPABASE_URL(없으면 SUPABASE_DB_URL 의 프로젝트 ref로 만든다), SUPABASE_SERVICE_ROLE_KEY
// 공개 저장소이므로 로그에 파일 이름을 찍지 않는다(건수 · 용량만).
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const [listFile, outDir] = process.argv.slice(2)
if (!listFile || !outDir) {
  console.error('사용: node backup-storage.mjs <objects.json> <저장 폴더>')
  process.exit(2)
}

function projectUrl() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL.replace(/\/+$/, '')
  const db = process.env.SUPABASE_DB_URL || ''
  const user = decodeURIComponent((db.split('://')[1] || '').split('@')[0].split(':')[0])
  if (user.startsWith('postgres.')) return `https://${user.slice('postgres.'.length)}.supabase.co`
  const host = (db.split('@')[1] || '').split(/[:/]/)[0]
  const m = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/)
  if (m) return `https://${m[1]}.supabase.co`
  throw new Error('SUPABASE_URL 을 알 수 없습니다(SUPABASE_URL 비밀값을 추가하세요)')
}

const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!key) {
  console.error('::error::SUPABASE_SERVICE_ROLE_KEY 가 없습니다')
  process.exit(1)
}
const base = projectUrl()
// 새 형식 비밀 키(sb_secret_...)는 apikey 헤더만, 기존 JWT 서비스 키는 Authorization 도 함께.
const headers = key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` }

const objects = JSON.parse(await readFile(listFile, 'utf8'))
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/')

// 저장 경로가 작업 폴더 밖으로 나가지 않게 막는다.
function safeTarget(bucket, name) {
  const root = path.resolve(outDir)
  const target = path.resolve(root, bucket, name)
  if (!target.startsWith(root + path.sep)) throw new Error('잘못된 파일 경로')
  return target
}

async function download(obj) {
  const url = `${base}/storage/v1/object/${encodeURIComponent(obj.bucket)}/${encodePath(obj.name)}`
  let lastErr
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const target = safeTarget(obj.bucket, obj.name)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, buf)
      return buf.length
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)))
    }
  }
  throw lastErr
}

let done = 0
let bytes = 0
const failed = []
const queue = [...objects]
async function worker() {
  while (queue.length) {
    const obj = queue.shift()
    try {
      bytes += await download(obj)
      done++
    } catch (e) {
      failed.push({ bucket: obj.bucket, name: obj.name, error: String(e.message || e) })
    }
  }
}
await mkdir(outDir, { recursive: true })
await Promise.all(Array.from({ length: 6 }, worker))

// 실패 목록은 암호화되는 묶음 안에만 남긴다.
await writeFile(path.join(outDir, '..', 'storage-failed.json'), JSON.stringify(failed, null, 2))
const mb = (bytes / 1024 / 1024).toFixed(1)
console.log(`파일 저장소 복사: ${done}/${objects.length}개 · ${mb} MB`)
if (failed.length) {
  console.log(`::error::파일 ${failed.length}개를 내려받지 못했습니다(목록은 백업 묶음의 storage-failed.json)`)
  process.exit(1)
}
