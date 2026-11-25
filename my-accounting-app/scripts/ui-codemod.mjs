#!/usr/bin/env node
// UI 통일 1단계 일괄 변환 (UI 디자인 트랙, 2026-11-25) — docs/ui-design-track.md
//  ① 회색 gray → slate (테마 변수 한 계열). 글자 · 테두리는 한 단계 진하게 옮긴다.
//  ② 12px 보다 작은 글자(text-[0.625rem] · [0.6875rem] …) → text-xs
// 여러 번 돌려도 결과가 같다(gray 가 남아 있을 때만 바뀜). 다른 브랜치를 main 에 합칠 때 충돌이 나면
//   자기 쪽 내용을 고른 뒤 `node scripts/ui-codemod.mjs` 를 다시 돌리면 된다.
//  --slate-once : 이미 slate 로 쓰인 글자 · 테두리도 한 단계 옮긴다. 2026-11-25 에 한 번 실행함 — 다시 쓰지 말 것(두 번 진해진다).
//  --check      : 바꾸지 않고 남은 건수만 출력
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const slateOnce = process.argv.includes('--slate-once')
const checkOnly = process.argv.includes('--check')
// 어두운 바탕 위에 밝은 글자를 쓰는 파일 — 이름만 바꾸고 진하기 · 글자 크기는 건드리지 않는다
const DARK_FILES = ['components/layout/AreaSidebar.tsx', 'components/layout/NotificationCenter.tsx', 'app/portal/', 'app/login/', 'app/(orders)/orders/check-widget.tsx']
const TEXT = { 300: 400, 400: 500, 500: 600, 600: 700, 700: 800, 800: 900 }
const LINE = { 50: 200, 100: 200, 200: 300, 300: 400 }
const DARK_BG = /bg-(?:slate|gray)-(?:600|700|800|900|950)\b|bg-black\b|bg-(?:red|rose|blue|sky|indigo|violet|purple|emerald|green|teal|amber|orange)-(?:500|600|700|800|900)\b/
const TOKEN = /(placeholder:)?\b(text|bg|border(?:-[trblxy])?|ring(?:-offset)?|divide|outline|from|via|to|placeholder|decoration|fill|stroke|accent|caret|shadow)-(gray|slate)-(\d{2,3})\b/g
const SMALL = /\btext-\[0\.(?:625|65625|6875|71875|75)rem\]/g

const files = []
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else if (/\.(tsx|ts)$/.test(f)) files.push(p) } }
for (const d of ['app', 'components', 'lib']) walk(join(root, d))

// 토큰이 든 문자열 조각(따옴표 사이)을 돌려준다 — 같은 조각에 어두운 바탕이 있으면 글자를 진하게 하지 않는다
const segmentOf = (line, idx) => {
  let a = idx; while (a > 0 && !`'"\``.includes(line[a - 1])) a--
  let b = idx; while (b < line.length && !`'"\``.includes(line[b])) b++
  return line.slice(a, b)
}
let changed = 0, left = 0
for (const f of files) {
  const rel = relative(root, f).split('\\').join('/')
  const dark = DARK_FILES.some(d => rel.startsWith(d))
  const src = readFileSync(f, 'utf8')
  const out = src.split('\n').map(line => {
    let l = line.replace(TOKEN, (m, ph, util, fam, n, idx) => {
      if (fam === 'slate' && !slateOnce) return m
      if (fam === 'gray') left++
      let lv = +n
      const isText = util === 'text', isLine = util.startsWith('border') || util === 'divide'
      if (ph || util === 'placeholder') lv = isText || util === 'placeholder' ? (fam === 'gray' ? lv : lv) : lv
      else if (!dark && isText && TEXT[lv] && !DARK_BG.test(segmentOf(line, idx))) lv = TEXT[lv]
      else if (!dark && isLine && LINE[lv]) lv = LINE[lv]
      return `${ph ?? ''}${util}-slate-${lv}`
    })
    if (!dark) l = l.replace(SMALL, m => { left++; return 'text-xs' })
    return l
  }).join('\n')
  if (out !== src) { changed++; if (!checkOnly) writeFileSync(f, out) }
}
console.log(`[ui-codemod] ${checkOnly ? '남은' : '바꾼'} 파일 ${changed} · 대상 ${left}곳`)
