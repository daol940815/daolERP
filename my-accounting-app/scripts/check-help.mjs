#!/usr/bin/env node
// 도움말 검사 — `npm run build` 앞(prebuild)에서 실행 (도움말 트랙, 2026-11-03)
//  ① 메뉴(lib/menu-registry.ts)에 있는 화면인데 도움말 항목(lib/help-registry.ts HELP)도 허용 목록(HELP_PENDING)도 아니면 → 실패
//  ② 항목이 있는데 HELP_PENDING 에도 남아 있으면 → 실패(지우라고 알려줌)
//  ③ 화면 파일(app/**/page.tsx)의 마지막 git 커밋일이 항목의 updated 보다 뒤면 → 경고(실패 아님). git 이 없으면 건너뜀.
// 정규식으로 읽는다(ts 실행 환경 불필요). 항목 모양이 바뀌면 이 스크립트도 같이 고칠 것.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { execSync } from 'node:child_process'

const root = process.cwd()
const read = p => readFileSync(join(root, p), 'utf8')
const menuSrc = read('lib/menu-registry.ts')
const helpSrc = read('lib/help-registry.ts')

// 메뉴 href (MENU 배열 구간만, API_OWNERS 는 제외)
const menuPart = menuSrc.slice(menuSrc.indexOf('export const MENU'), menuSrc.indexOf('export function ownersOf'))
const menuHrefs = Array.from(new Set(Array.from(menuPart.matchAll(/href:\s*'([^']+)'/g)).map(m => m[1])))
  .filter(h => !/wip:\s*true/.test(menuPart.split(`href: '${h}'`)[1]?.split('\n')[0] ?? ''))   // 준비 중 화면은 제외
// 도움말 항목 href + updated
const helpPart = helpSrc.slice(helpSrc.indexOf('export const HELP:'), helpSrc.indexOf('export const HELP_PENDING'))
const entries = Array.from(helpPart.matchAll(/href:\s*'([^']+)'[\s\S]*?updated:\s*'(\d{4}-\d{2}-\d{2})'/g)).map(m => ({ href: m[1], updated: m[2] }))
const pendingPart = helpSrc.slice(helpSrc.indexOf('export const HELP_PENDING'), helpSrc.indexOf('// ── 조회 도우미'))
const pending = Array.from(pendingPart.matchAll(/'([^']+)'/g)).map(m => m[1])

const base = h => h.split('?')[0]
const have = new Set(entries.map(e => base(e.href)))
const errors = [], warns = []
for (const h of menuHrefs) {
  const b = base(h)
  if (!have.has(b) && !pending.includes(b)) errors.push(`도움말 없음: ${h} — lib/help-registry.ts 에 항목을 쓰거나 HELP_PENDING 에 추가`)
}
for (const p of pending) if (have.has(p)) errors.push(`HELP_PENDING 에서 지울 것: ${p} (항목이 이미 있음)`)

// 화면 파일 신선도 — app/**/page.tsx 의 경로를 라우트로 환산해 항목과 대조
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) { const p = join(dir, f); const s = statSync(p); if (s.isDirectory()) walk(p, out); else if (f === 'page.tsx') out.push(p) }
  return out
}
const routeOf = file => '/' + relative(join(root, 'app'), file).replace(/\\/g, '/').split('/').slice(0, -1).filter(seg => !/^\(.*\)$/.test(seg)).join('/')
let gitOk = true
const lastCommit = file => { try { return execSync(`git log -1 --format=%cs -- "${file}"`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { gitOk = false; return '' } }
const pages = new Map(walk(join(root, 'app')).map(f => [routeOf(f) || '/', f]))
for (const e of entries) {
  const file = pages.get(base(e.href))
  if (!file) continue
  const d = lastCommit(relative(root, file))
  if (!gitOk) break
  if (d && d > e.updated) warns.push(`도움말이 화면보다 오래됨: ${e.href} (화면 ${d} > 도움말 ${e.updated}) — 내용 확인 후 updated 갱신`)
}

if (warns.length) { console.warn(`\n[check-help] 경고 ${warns.length}건`); warns.forEach(w => console.warn('  - ' + w)) }
if (!gitOk) console.warn('[check-help] git 이력을 읽을 수 없어 신선도 검사를 건너뜀')
if (errors.length) { console.error(`\n[check-help] 실패 ${errors.length}건`); errors.forEach(e => console.error('  - ' + e)); process.exit(1) }
console.log(`[check-help] 통과 — 메뉴 ${menuHrefs.length} · 도움말 ${entries.length} · 미작성 ${pending.length}${warns.length ? ` · 경고 ${warns.length}` : ''}`)
