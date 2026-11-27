// 백업 시점 데이터로 앱의 "엑셀 다운로드"를 그대로 만들어 보기용 엑셀 폴더에 저장한다.
// 앱 화면의 엑셀 다운로드와 같은 코드(app/api/**/export/route.ts)를 쓰므로 열 · 모양이 화면 다운로드와 같다.
// 기간이 있는 것은 "전체 기간"(DATA_START ~ 오늘). 하나가 실패해도 나머지는 계속 만든다.
// 사용(build.mjs 가 묶은 뒤): node run.cjs <저장 폴더>
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (읽기만 한다)
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { DATA_START } from '@/lib/period-presets'

import * as ordersPortal from '@/app/api/orders-portal/export/route'
import * as products from '@/app/api/orders-portal/products/export/route'
import * as vendorHub from '@/app/api/vendor-hub/export/route'
import * as contactManager from '@/app/api/contact-manager/export/route'
import * as erpAliases from '@/app/api/erp-aliases/export/route'
import * as transactions from '@/app/api/transactions/export/route'
import * as taxInvoices from '@/app/api/tax-invoices/export/route'
import * as cardExpenses from '@/app/api/card-expenses/export/route'
import * as cardSales from '@/app/api/card-sales/export/route'
import * as cashReceipts from '@/app/api/cash-receipts/export/route'
import * as journal from '@/app/api/journal/export/route'
import * as openingBalances from '@/app/api/opening-balances/export/route'
import * as vendorOpening from '@/app/api/vendor-opening-balances/export/route'
import * as receivablesAging from '@/app/api/reports/receivables-aging/export/route'
import * as payablesAging from '@/app/api/reports/payables-aging/export/route'

type Handler = (req: NextRequest) => Promise<Response> | Response

const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const all = { from: DATA_START, to: today }

// 파일 이름(번호 = 엑셀 폴더 정렬 순서) · 내보내기 · 조건
const EXPORTS: { file: string; mod: { GET: unknown }; query?: Record<string, string> }[] = [
  { file: '01_주문현황', mod: ordersPortal, query: all },
  { file: '02_매출처', mod: vendorHub, query: all },
  { file: '03_거래처담당자', mod: contactManager },
  { file: '04_품목', mod: products },
  { file: '05_ERP별칭', mod: erpAliases },
  { file: '11_통장내역', mod: transactions, query: all },
  { file: '12_계산서', mod: taxInvoices, query: all },
  { file: '13_카드지출', mod: cardExpenses, query: all },
  { file: '14_카드매출', mod: cardSales, query: all },
  { file: '15_현금영수증', mod: cashReceipts, query: all },
  { file: '16_분개', mod: journal, query: all },
  { file: '17_기초잔액', mod: openingBalances },
  { file: '18_거래처기초잔액', mod: vendorOpening },
  { file: '21_미수금(백업일 기준)', mod: receivablesAging },
  { file: '22_미지급금(백업일 기준)', mod: payablesAging },
]

async function main() {
  const out = process.argv[2]
  if (!out) throw new Error('저장 폴더를 지정하세요')
  await mkdir(out, { recursive: true })
  let ok = 0
  const failed: string[] = []
  for (const e of EXPORTS) {
    try {
      const url = new URL('http://backup.local/export')
      for (const [k, v] of Object.entries(e.query ?? {})) url.searchParams.set(k, v)
      const res = await (e.mod.GET as Handler)(new NextRequest(url))
      const type = res.headers.get('content-type') ?? ''
      if (res.status === 404) { failed.push(`${e.file}: 자료 없음`); continue }
      if (!res.ok || !type.includes('spreadsheetml')) {
        const body = (await res.text()).slice(0, 200)
        throw new Error(`응답 ${res.status} ${body}`)
      }
      await writeFile(path.join(out, `${e.file}.xlsx`), Buffer.from(await res.arrayBuffer()))
      ok++
    } catch (err) {
      failed.push(`${e.file}: ${(err as Error).message}`)
    }
  }
  // 실패 내용은 공개될 수 있는 로그가 아니라 묶음 안 파일에만 남긴다.
  await writeFile(path.join(out, '_만들기결과.txt'),
    [`만든 날(한국): ${today}`, `기간: ${all.from} ~ ${all.to}`, `성공 ${ok} / ${EXPORTS.length}`, ...failed].join('\n') + '\n')
  console.log(`보기용 엑셀: ${ok}/${EXPORTS.length}개${failed.length ? ` (못 만든 것 ${failed.length}개 — 묶음 안 _만들기결과.txt)` : ''}`)
}

main().catch(err => { console.error(`::warning::보기용 엑셀 만들기 실패: ${(err as Error).message}`); process.exit(1) })
