#!/usr/bin/env node
// 비상 복원용: 백업 묶음의 storage/ 폴더 파일을 (새) Supabase 프로젝트의 같은 버킷 · 같은 경로로 올린다.
// DB 복원(roles → schema → data)을 먼저 끝낸 뒤 실행한다 — 버킷과 파일 목록(storage.objects)은 DB 복원으로 이미 들어와 있다.
// 사용: node restore-storage.mjs <풀어 놓은 백업 폴더>
// 환경변수: SUPABASE_URL(복원 대상 프로젝트 주소), SUPABASE_SERVICE_ROLE_KEY(복원 대상 프로젝트의 서비스 키)
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const bk = process.argv[2]
const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!bk || !base || !key) {
  console.error('사용: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node restore-storage.mjs <백업 폴더>')
  process.exit(2)
}
const auth = key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` }
const objects = JSON.parse(await readFile(path.join(bk, 'db', 'storage-objects.json'), 'utf8'))
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/')

let ok = 0
const failed = []
const queue = [...objects]
async function worker() {
  while (queue.length) {
    const o = queue.shift()
    try {
      const body = await readFile(path.join(bk, 'storage', o.bucket, o.name))
      const res = await fetch(`${base}/storage/v1/object/${encodeURIComponent(o.bucket)}/${encodePath(o.name)}`, {
        method: 'POST',
        headers: { ...auth, 'x-upsert': 'true', 'Content-Type': o.mimetype || 'application/octet-stream' },
        body,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`)
      ok++
    } catch (e) {
      failed.push(`${o.bucket}/${o.name}: ${e.message || e}`)
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker))
console.log(`파일 복원: ${ok}/${objects.length}개`)
if (failed.length) {
  // GitHub 로그는 공개이므로 파일 이름은 직접 실행할 때만 찍는다.
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error::파일 ${failed.length}개를 올리지 못했습니다`)
  else console.log(failed.join('\n'))
  process.exit(1)
}
