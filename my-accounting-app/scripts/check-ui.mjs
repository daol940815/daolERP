#!/usr/bin/env node
// 화면 규칙 검사 — `npm run build` 앞(prebuild)에서 실행 (직원별 화면 설정, 2026-11-05)
//  ① 고정 px 글자 크기 text-[Npx] → 실패. 글자 크기 설정(<html> font-size)이 안 먹는다. rem 으로: 11px = text-[0.6875rem], 12px = text-xs
//  ② 색 코드를 클래스에 직접 (bg-[#…] 등) → 실패. 색 테마를 안 따라간다. Tailwind 색 이름을 쓸 것
//  ③ 기본 회색 계열은 slate(테마 변수) · gray 만. zinc · neutral · stone → 실패
//  참고 출력: 인라인 style 의 색 코드 개수(차트 · 의미 색 — 실패 아님)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const files = []
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else if (/\.(tsx|ts)$/.test(f)) files.push(p) } }
for (const d of ['app', 'components', 'lib']) walk(join(root, d))

const rules = [
  { re: /\btext-\[\d+(?:\.\d+)?px\]/g, msg: '고정 px 글자 크기 — rem 으로 (예: text-[0.6875rem])' },
  { re: /\b(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|divide|shadow)-\[#[0-9a-fA-F]{3,8}\]/g, msg: '클래스에 색 코드 직접 — Tailwind 색 이름으로' },
  { re: /\b(?:bg|text|border|ring|from|via|to|divide)-(?:zinc|neutral|stone)-\d{2,3}\b/g, msg: '기본 회색은 slate · gray 만 (zinc · neutral · stone 금지)' },
]
// UI 통일 기준(2026-11-25): 회색은 slate 한 계열, 12px 보다 작은 글자 금지. 2026-11-26 부터 **실패**(4단계 — 그 전에는 경고).
//  걸리면 `node scripts/ui-codemod.mjs` 를 한 번 돌리면 고쳐진다(여러 번 돌려도 같음). 어두운 화면(사이드바 · 알림 · 업무 선택 · 로그인 · 출근 위젯)은 검사하지 않는다.
const softRules = [
  { re: /\b(?:text|bg|border|ring|divide|from|via|to|placeholder)-gray-\d{2,3}\b/g, msg: 'gray 회색' },
  { re: /\btext-\[0\.(?:625|65625|6875|71875)rem\]/g, msg: '12px 보다 작은 글자' },
]
const soft = {}
const errors = []
let inlineHex = 0
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return   // 주석 줄은 건너뜀
    if (!/components\/layout\/(AreaSidebar|NotificationCenter)|app\/(portal|login)\/|check-widget/.test(f.split('\\').join('/'))) for (const r of softRules) { const n = (line.match(r.re) ?? []).length; if (n) soft[r.msg] = (soft[r.msg] ?? 0) + n }
    for (const r of rules) for (const m of line.matchAll(r.re)) errors.push(`${relative(root, f)}:${i + 1}  ${m[0]}  — ${r.msg}`)
    if (f.endsWith('.tsx')) inlineHex += (line.match(/['"]#[0-9a-fA-F]{6}['"]/g) ?? []).length
  })
}
const softTotal = Object.values(soft).reduce((a, n) => a + n, 0)
if (softTotal) {
  console.error(`\n[check-ui] 실패 — UI 통일 기준에 안 맞는 표기 ${softTotal}곳 (${Object.entries(soft).map(([k, n]) => `${k} ${n}`).join(' · ')})`)
  console.error('  고치는 법: my-accounting-app 에서  node scripts/ui-codemod.mjs  를 한 번 실행한 뒤 다시 빌드 (자동으로 slate · text-xs 로 바뀝니다)')
  console.error('  기준: CLAUDE.md UI 관례 › UI 통일 기준 · docs/ui-design-track.md')
  process.exit(1)
}
if (errors.length) {
  console.error(`\n[check-ui] 실패 ${errors.length}건 — 직원별 글자 크기 · 색 테마가 이 부분에 적용되지 않습니다`)
  errors.slice(0, 40).forEach(e => console.error('  - ' + e))
  if (errors.length > 40) console.error(`  … 외 ${errors.length - 40}건`)
  process.exit(1)
}
console.log(`[check-ui] 통과 — 파일 ${files.length} · 인라인 색 코드 ${inlineHex}곳(차트 · 의미 색, 테마 대상 아님)`)
