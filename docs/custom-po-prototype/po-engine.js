/* 매입처 자체 발주서 생성 엔진 (시안) — 다올커머스
 * 하나의 통합 주문 데이터 → 매입처별 원본 양식 파일(xlsx)에 값을 채워 발주서 생성.
 * 노드(require('exceljs'))와 브라우저(window.ExcelJS) 공용. 서버 이식 시 lib/custom-po.ts 레지스트리로 옮긴다.
 *
 * 핵심 개념
 *  - 프로필(PROFILE): 매입처 1곳 = 양식 파일 1개 + 칸 연결 규칙. 업체 추가 = 프로필 추가(코드 수정 최소).
 *  - 칸 연결 3종: cells(머리 칸 1개씩) / rows(품목 · 수령인 행 반복, 모자라면 서식 복사해 행 추가) /
 *    catalog(양식에 품목 목록이 미리 인쇄된 경우 — 코드로 행을 찾아 수량만 기입, 없는 품목은 행 추가)
 *  - 행 단위(scope): item = 품목 1개당 1행 / recipientItem = 수령인 × 품목 1행 (개별 배송 명단형)
 *  - 묶음(grouping): order = 주문 1건당 파일 1개 / day = 같은 날 주문을 한 파일에 모음(행 반복형 양식만)
 *  - 원본 수식 · 병합 · 서식 · 드롭다운 · 숨김 시트 · 그림 · 메모는 손대지 않는다. 비우는 칸만 값을 쓴다.
 */
;(function (root) {
  'use strict'

  // ── 공용 값 ────────────────────────────────────────────
  const COMPANY = { name: '다올커머스', tel: '031-922-4582', fax: '031-624-4584' }
  const SHIP_LABEL = { 지점: '지점배송', 개별: '개별배송', 샘플: '샘플' }

  const pad = n => String(n).padStart(2, '0')
  const toDate = s => (s instanceof Date ? s : s ? new Date(String(s).slice(0, 10) + 'T00:00:00') : null)
  function fmtDate(s, f) {
    const d = toDate(s); if (!d || isNaN(d)) return ''
    const Y = d.getFullYear(), M = pad(d.getMonth() + 1), D = pad(d.getDate())
    return f.replace('YYYY', Y).replace('YY', String(Y).slice(2)).replace('MM', M).replace('DD', D)
  }
  const honor = (name, title) => (name ? `${name}${title ? ` ${title}님` : ' 님'}` : '')
  const shipLabel = k => SHIP_LABEL[k] || k || ''
  // 셀 글자 (서식 있는 글자 · 수식 결과 포함)
  const cellText = v => (v == null ? '' : v.richText ? v.richText.map(t => t.text).join('') : typeof v === 'object' && 'result' in v ? String(v.result ?? '') : String(v))

  // ── 통합 주문 정규화: 수령인 목록 · 품목 배분 ───────────────
  // 지점 · 샘플 배송은 주문 배송지가 수령인 1명. 개별 배송은 recipients[]에 수령인별 품목 배분(items:[{line, qty}])
  function recipientsOf(order) {
    if (order.recipients && order.recipients.length) return order.recipients
    const s = order.ship || {}
    return [{ id: 'R0', name: s.name || order.manager_name || '', phone: s.phone || order.manager_phone || '',
      phone2: s.phone2 || '', zip: s.zip || '', addr: [s.addr1, s.addr2].filter(Boolean).join(' '), message: order.delivery_note || '' }]
  }
  // 수령인 × 품목 행 — 배분이 있으면 그대로, 없으면 수령인 1명에게 전량 / 여러 명이면 1개씩(경고)
  function recipientItemRows(order, items, warn) {
    const rs = recipientsOf(order)
    const out = []
    for (const r of rs) {
      if (r.items && r.items.length) {
        for (const a of r.items) { const it = items.find(x => x.line === a.line); if (it) out.push({ r, it, qty: a.qty }) }
      } else if (rs.length === 1) {
        for (const it of items) out.push({ r, it, qty: it.qty })
      } else {
        for (const it of items) out.push({ r, it, qty: 1 })
      }
    }
    for (const it of items) {
      const sum = out.filter(x => x.it === it).reduce((s, x) => s + Number(x.qty || 0), 0)
      if (sum !== Number(it.qty)) warn(`${it.name}: 수령인 배분 합계 ${sum}개 ≠ 주문 수량 ${it.qty}개 — 배분 확인 필요`)
    }
    return out
  }

  // ── 값 계산: '{o.customer}' 문자열 템플릿 또는 함수 ─────────
  function evalVal(spec, ctx) {
    if (spec === undefined) return undefined
    if (typeof spec === 'function') return spec(ctx)
    if (typeof spec !== 'string') return spec
    const whole = spec.match(/^\{([^}]+)\}$/)
    if (whole) return pick(ctx, whole[1])   // 단독 치환은 타입 유지(숫자 · 날짜)
    return spec.replace(/\{([^}]+)\}/g, (_, p) => { const v = pick(ctx, p); return v == null ? '' : String(v) })
  }
  function pick(ctx, path) { return path.split('.').reduce((v, k) => (v == null ? v : v[k]), ctx) }

  // ── 시트 조작: 행 끼워 넣기(병합 · 수식 · 인쇄영역 보정) ─────
  const colNum = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
  const colStr = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
  // 수식 안 셀 참조의 행 번호를 at 이상이면 +count (같은 시트 참조만, 시트명 붙은 참조 · 열 전체 참조 제외)
  function shiftFormula(f, at, count) {
    return f.replace(/(^|[^A-Za-z0-9_!$'"])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/g, (m, pre, d1, c, d2, r) => {
      const n = Number(r); return pre + d1 + c + d2 + (n >= at ? n + count : n)
    })
  }
  function cloneStyle(st) { return st ? JSON.parse(JSON.stringify(st)) : {} }

  function insertRowsBefore(ws, at, count, styleRowNo) {
    if (count <= 0) return
    const last = ws.rowCount, maxCol = Math.max(ws.columnCount, 1)
    // 1) 영향받는 병합 해제
    // ws._merges = { 주소: Range } — 병합 칸은 읽기 · 쓰기가 대표 칸으로 가므로 옮기기 전에 반드시 해제
    const merges = Object.values(ws._merges || {}).map(rg => ({ top: rg.top, left: rg.left, bottom: rg.bottom, right: rg.right }))
    const moved = []
    for (const m of merges) {
      if (m.top >= at) { ws.unMergeCells(m.top, m.left, m.bottom, m.right); moved.push({ top: m.top + count, left: m.left, bottom: m.bottom + count, right: m.right }) }
    }
    // 2) 아래 행을 아래로 이동 (값 · 서식 · 높이)
    for (let r = last; r >= at; r--) {
      const src = ws.getRow(r), dst = ws.getRow(r + count)
      dst.height = src.height
      for (let c = 1; c <= maxCol; c++) {
        const s = src.getCell(c), d = dst.getCell(c)
        d.style = cloneStyle(s.style)
        d.value = s.formula ? { formula: shiftFormula(s.formula, at, count) } : s.value
        s.value = null
      }
    }
    // 3) 새 행 = 기준 행 서식 + 기준 행 수식(행 번호 바꿈)
    const base = ws.getRow(styleRowNo)
    for (let i = 0; i < count; i++) {
      const r = at + i, row = ws.getRow(r)
      row.height = base.height
      for (let c = 1; c <= maxCol; c++) {
        const b = base.getCell(c), d = row.getCell(c)
        d.style = cloneStyle(b.style)
        d.value = b.formula ? { formula: b.formula.replace(new RegExp(`([A-Z]{1,3})${styleRowNo}(?!\\d)`, 'g'), `$1${r}`) } : null
      }
    }
    // 4) 위쪽 수식: 범위 끝이 at-1이면 늘리고, at 이상 참조는 밀기 (예: SUM(G9:G24) → SUM(G9:G26))
    for (let r = 1; r < at; r++) {
      ws.getRow(r).eachCell({ includeEmpty: false }, cell => {
        if (!cell.formula) return
        let f = cell.formula.replace(/(\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?)(\d+)/g, (m, c1, r1, c2, r2) =>
          (Number(r1) < at && Number(r2) === at - 1) ? `${c1}${r1}:${c2}${Number(r2) + count}` : m)
        f = shiftFormula(f, at, count)
        cell.value = { formula: f }
      })
    }
    // 아래 수식 중 위 범위를 가리키던 SUM 등도 끝 행 보정 (이동하면서 at 이상만 밀렸으므로 끝=at-1 범위를 늘림)
    for (let r = at + count; r <= last + count; r++) {
      ws.getRow(r).eachCell({ includeEmpty: false }, cell => {
        if (!cell.formula) return
        const f = cell.formula.replace(/(\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?)(\d+)/g, (m, c1, r1, c2, r2) =>
          (Number(r1) < at && Number(r2) === at - 1) ? `${c1}${r1}:${c2}${Number(r2) + count}` : m)
        cell.value = { formula: f }
      })
    }
    // 5) 병합 다시
    for (const m of moved) ws.mergeCells(m.top, m.left, m.bottom, m.right)
    // 6) 인쇄 영역
    const pa = ws.pageSetup && ws.pageSetup.printArea
    if (pa) ws.pageSetup.printArea = pa.replace(/(\$?[A-Z]+\$?)(\d+)/g, (m, c, r) => c + (Number(r) >= at ? Number(r) + count : r))
  }

  function setCell(ws, addr, v) {
    if (v === undefined) return            // undefined = 원본 값 유지
    const cell = ws.getCell(addr)
    if (cell.formula && v === null) return // 원본 수식 칸은 비우지 않는다
    cell.value = v === '' ? null : v
  }

  // ── 채우기 3종 ─────────────────────────────────────────
  function fillCells(ws, spec, ctx) {
    for (const [addr, val] of Object.entries(spec)) setCell(ws, addr, evalVal(val, ctx))
  }

  // rows: { startRow, endRow(양식에 준비된 마지막 행), insertBefore?(꼬리 영역 시작 행 — 있으면 그 앞에 끼워 넣음), scope, columns{열: 값} }
  function fillRows(ws, spec, lines, ctx, warn) {
    const cap = spec.endRow - spec.startRow + 1
    if (lines.length > cap) {
      const extra = lines.length - cap
      if (spec.insertBefore) insertRowsBefore(ws, spec.insertBefore, extra, spec.endRow)
      else {
        // 꼬리 영역 없음 = 마지막 행 서식 · 수식을 복사해 아래로 늘림
        const base = ws.getRow(spec.endRow)
        for (let i = 1; i <= extra; i++) {
          const r = spec.endRow + i, row = ws.getRow(r)
          row.height = base.height
          base.eachCell({ includeEmpty: true }, (b, c) => {
            const d = row.getCell(c); d.style = cloneStyle(b.style)
            if (b.formula) d.value = { formula: b.formula.replace(new RegExp(`([A-Z]{1,3})${spec.endRow}(?!\\d)`, 'g'), `$1${r}`) }
            else if (spec.copyValues && spec.copyValues.includes(colStr(c))) d.value = typeof b.value === 'number' ? b.value + i : b.value
          })
        }
      }
      warn(`양식 준비 행 ${cap}개보다 ${extra}행 많아 서식을 복사해 행을 늘렸습니다.`)
    }
    lines.forEach((ln, i) => {
      const r = spec.startRow + i
      const lctx = { ...ctx, ...ln, n: i + 1 }
      for (const [col, val] of Object.entries(spec.columns)) setCell(ws, `${col}${r}`, evalVal(val, lctx))
    })
  }

  // catalog: 양식에 인쇄된 품목 목록에서 코드(또는 품명)로 행을 찾아 qty 열만 기입. 없으면 꼬리 앞에 행 추가
  function fillCatalog(ws, spec, items, ctx, warn) {
    let end = spec.endRow
    const findRow = it => {
      for (let r = spec.startRow; r <= end; r++) {
        const code = cellText(ws.getCell(`${spec.codeCol}${r}`).value).trim()
        const name = cellText(ws.getCell(`${spec.nameCol}${r}`).value).replace(/\s+/g, ' ').trim()
        if (it.vendor_code && code === it.vendor_code) return r
        if (!it.vendor_code && name && name === String(it.name).replace(/\s+/g, ' ').trim()) return r
      }
      return 0
    }
    for (const it of items) {
      let r = findRow(it)
      if (!r) {
        insertRowsBefore(ws, end + 1, 1, end)
        end += 1; r = end
        for (const [col, val] of Object.entries(spec.newRow)) setCell(ws, `${col}${r}`, evalVal(val, { ...ctx, it, n: r - spec.startRow + 1 }))
        warn(`${it.name}: 양식 품목 목록에 없어 ${r}행에 새로 추가했습니다 (코드 ${it.vendor_code || '없음'}) — 업체 확인 필요`)
      }
      setCell(ws, `${spec.qtyCol}${r}`, evalVal(spec.qty, { ...ctx, it }))
    }
  }

  // ── 파일 1개 생성 ───────────────────────────────────────
  async function buildFile(ExcelJS, profile, templateBuf, batch, seq) {
    const warnings = []
    const warn = m => { if (!warnings.includes(m)) warnings.push(m) }
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(templateBuf)
    wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true }   // 열 때 수식 다시 계산
    const first = batch[0]
    const baseCtx = { o: first.order, items: first.items, C: COMPANY, f: helpers, seq }

    for (const sh of profile.sheets) {
      const ws = wb.getWorksheet(sh.name)
      if (!ws) { warn(`시트 '${sh.name}'가 양식에 없습니다.`); continue }
      if (sh.cells) fillCells(ws, sh.cells, baseCtx)
      if (sh.rows) {
        const lines = []
        for (const b of batch) {
          const ctx = { o: b.order, items: b.items }
          if (sh.rows.scope === 'recipientItem') for (const x of recipientItemRows(b.order, b.items, warn)) lines.push({ ...ctx, r: x.r, it: x.it, qty: x.qty })
          else for (const it of b.items) lines.push({ ...ctx, it, qty: it.qty })
        }
        fillRows(ws, sh.rows, lines, baseCtx, warn)
      }
      if (sh.catalog) fillCatalog(ws, sh.catalog, first.items, baseCtx, warn)
      if (sh.validate) sh.validate(ws, batch, warn)
    }
    // 빈 필수 값 점검
    for (const b of batch) for (const it of b.items) {
      if (!it.qty) warn(`${it.name}: 수량이 비어 있습니다.`)
      if (profile.needsPrice && !it.unit_price) warn(`${it.name}: 매입 단가가 비어 있습니다.`)
    }
    const fileName = evalVal(profile.fileName, { ...baseCtx, batch }) + '.xlsx'
    const buf = await wb.xlsx.writeBuffer()
    return { fileName, buffer: buf, warnings, profile: profile.key, orders: batch.map(b => b.order.order_no) }
  }

  // ── 전체: 주문들 → 매입처 분류 → 묶음 → 파일들 ────────────────
  function splitByVendor(orders, profiles) {
    const groups = new Map(), unmatched = []
    for (const order of orders) {
      const byVendor = new Map()
      for (const it of order.items) {
        const list = byVendor.get(it.vendor) || []; list.push(it); byVendor.set(it.vendor, list)
      }
      for (const [vendor, items] of byVendor) {
        const p = profiles.find(pf => pf.match(vendor))
        if (!p) { unmatched.push({ order: order.order_no, vendor, items: items.length }); continue }
        const key = p.grouping === 'day' ? `${p.key}|${order.order_date}` : `${p.key}|${order.order_no}`
        if (!groups.has(key)) groups.set(key, { profile: p, batch: [] })
        groups.get(key).batch.push({ order, items: items.filter(it => !(p.excludeRoles || []).includes(it.role)) })
      }
    }
    return { groups: Array.from(groups.values()), unmatched }
  }

  async function generateAll(ExcelJS, orders, profiles, templates) {
    const { groups, unmatched } = splitByVendor(orders, profiles)
    const seqs = {}, files = []
    for (const g of groups) {
      const day = g.batch[0].order.order_date
      const k = `${g.profile.key}|${day}`; seqs[k] = (seqs[k] || 0) + 1
      files.push(await buildFile(ExcelJS, g.profile, templates[g.profile.template], g.batch, seqs[k]))
    }
    return { files, unmatched }
  }

  // ── 통합 주문 입력 엑셀 (시안용 — 실제 ERP에서는 주문서 입력 화면이 이 역할) ─────────
  // 시트 3장: 주문(1주문 1행) / 품목(1품목 1행, 매입처 칸으로 자동 분류) / 수령인(개별 배송: 수령인 × 품목 배분 1행)
  const INPUT = {
    주문: [['order_no', '주문번호'], ['order_date', '주문일'], ['ship_request', '출고요청일'], ['customer', '주문처(은행 지점)'],
      ['sender_name', '보내는분 명의(비우면 주문처)'], ['manager_name', '고객 담당자'], ['manager_title', '직함'], ['manager_phone', '고객 연락처'],
      ['staff_name', '다올 발주 담당'], ['staff_phone', '담당 핸드폰'], ['ship_kind', '배송구분(지점/개별/샘플)'],
      ['ship.name', '받는분(지점·샘플)'], ['ship.phone', '받는분 연락처'], ['ship.zip', '우편번호'], ['ship.addr1', '주소'], ['ship.addr2', '상세주소'],
      ['delivery_note', '배송메모']],
    품목: [['order_no', '주문번호'], ['line', '행번호'], ['vendor', '매입처'], ['vendor_code', '매입처 품목코드'], ['name', '품명(매입처 표기)'],
      ['option', '옵션'], ['qty', '수량'], ['unit', '단위'], ['pack_qty', '입수'], ['unit_price', '매입단가'], ['memo', '품목메모']],
    수령인: [['order_no', '주문번호'], ['rid', '수령인번호'], ['name', '받는분'], ['phone', '연락처'], ['phone2', '기타연락처'], ['zip', '우편번호'],
      ['addr', '주소'], ['message', '배송메세지'], ['line', '품목 행번호'], ['qty', '수량']],
  }
  const NUM = new Set(['line', 'qty', 'pack_qty', 'unit_price'])
  function setPath(o, path, v) { const ks = path.split('.'); let t = o; while (ks.length > 1) { const k = ks.shift(); t = t[k] = t[k] || {} } t[ks[0]] = v }
  function cellPlain(v) {
    if (v == null) return ''
    if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
    return cellText(v).trim()
  }
  function readSheet(ws, cols) {
    const head = {}; ws.getRow(1).eachCell((c, i) => { head[cellPlain(c.value)] = i })
    const out = []
    ws.eachRow((row, r) => {
      if (r === 1) return
      const rec = {}; let any = false
      for (const [key, label] of cols) {
        const i = head[label]; if (!i) continue
        let v = cellPlain(row.getCell(i).value)
        if (v !== '') any = true
        if (NUM.has(key)) v = v === '' ? null : Number(String(v).replace(/,/g, ''))
        setPath(rec, key, v)
      }
      if (any) out.push(rec)
    })
    return out
  }
  function ordersFromWorkbook(wb) {
    const need = n => { const ws = wb.getWorksheet(n); if (!ws) throw new Error(`입력 파일에 '${n}' 시트가 없습니다.`); return ws }
    const orders = readSheet(need('주문'), INPUT.주문)
    const items = readSheet(need('품목'), INPUT.품목)
    const rec = wb.getWorksheet('수령인') ? readSheet(wb.getWorksheet('수령인'), INPUT.수령인) : []
    for (const o of orders) {
      o.ship_request = o.ship_request || null
      o.items = items.filter(it => it.order_no === o.order_no).map(({ order_no, ...it }) => it)
      const rs = new Map()
      for (const x of rec.filter(x => x.order_no === o.order_no)) {
        if (!rs.has(x.rid)) rs.set(x.rid, { id: x.rid, name: x.name, phone: x.phone, phone2: x.phone2, zip: x.zip, addr: x.addr, message: x.message, items: [] })
        if (x.line) rs.get(x.rid).items.push({ line: x.line, qty: x.qty })
      }
      if (rs.size) o.recipients = Array.from(rs.values())
    }
    return orders
  }
  async function writeInputWorkbook(ExcelJS, orders) {
    const wb = new ExcelJS.Workbook()
    const head = (ws, cols) => {
      ws.columns = cols.map(([, label]) => ({ header: label, width: Math.max(10, label.length * 1.8) }))
      ws.getRow(1).font = { name: '맑은 고딕', bold: true }
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F7' } }
      ws.views = [{ state: 'frozen', ySplit: 1 }]
    }
    const w1 = wb.addWorksheet('주문'), w2 = wb.addWorksheet('품목'), w3 = wb.addWorksheet('수령인')
    head(w1, INPUT.주문); head(w2, INPUT.품목); head(w3, INPUT.수령인)
    for (const o of orders) {
      w1.addRow(INPUT.주문.map(([k]) => pick(o, k) ?? ''))
      for (const it of o.items) w2.addRow(INPUT.품목.map(([k]) => (k === 'order_no' ? o.order_no : it[k] ?? '')))
      for (const r of o.recipients || []) for (const a of r.items || []) {
        w3.addRow([o.order_no, r.id, r.name, r.phone, r.phone2 || '', r.zip || '', r.addr, r.message || '', a.line, a.qty])
      }
    }
    return wb.xlsx.writeBuffer()
  }

  // 프로필에서 쓰는 도우미
  const helpers = {
    date: fmtDate, honor, shipLabel,
    firstName: items => (items.length ? items[0].name + (items.length > 1 ? ` 외 ${items.length - 1}건` : '') : ''),
    totalQty: items => items.reduce((s, it) => s + Number(it.qty || 0), 0),
    amount: items => items.reduce((s, it) => s + Number(it.qty || 0) * Number(it.unit_price || 0), 0),
  }

  const api = { COMPANY, helpers, cellText, INPUT, ordersFromWorkbook, writeInputWorkbook, buildFile, splitByVendor, generateAll, recipientsOf, recipientItemRows, insertRowsBefore, evalVal }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.PoEngine = api
})(typeof window !== 'undefined' ? window : globalThis)
