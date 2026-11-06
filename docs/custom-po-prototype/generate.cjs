// 실행: node generate.cjs <통합주문입력.xlsx 또는 주문.json> <양식 폴더> <출력 폴더>
const ExcelJS = require('exceljs'), fs = require('fs'), path = require('path')
const E = require('./po-engine.js'), P = require('./po-profiles.js')
;(async () => {
  const [ordersFile, tplDir, outDir] = process.argv.slice(2)
  let orders
  if (/\.xlsx$/i.test(ordersFile)) { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(ordersFile); orders = E.ordersFromWorkbook(wb) }
  else orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8'))
  const templates = {}
  for (const p of P) templates[p.template] = fs.readFileSync(path.join(tplDir, p.template))
  const { files, unmatched } = await E.generateAll(ExcelJS, orders, P, templates)
  fs.mkdirSync(outDir, { recursive: true })
  for (const f of files) {
    fs.writeFileSync(path.join(outDir, f.fileName), Buffer.from(f.buffer))
    console.log(`[${f.profile}] ${f.fileName}  주문 ${f.orders.join(', ')}`)
    for (const w of f.warnings) console.log('   경고:', w)
  }
  for (const u of unmatched) console.log(`[자사 양식] ${u.order} · ${u.vendor} 품목 ${u.items}개 — 자체 양식 없음(기존 다올 발주서로)`)
})().catch(e => { console.error(e); process.exit(1) })
