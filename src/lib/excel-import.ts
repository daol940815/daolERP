import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────
// 엑셀 파싱 라이브러리
// (주)스피어스 자회사 종합관리 엑셀의 시트별 레이아웃을 이해하여
// 세금계산서 / 카드사용내역 / 통장거래 로 분류·정규화합니다.
// ─────────────────────────────────────────────────────────

export interface InvoiceInput {
  direction: "SALES" | "PURCHASE";
  taxType: "TAXABLE" | "TAX_FREE";
  monthCode: string | null;
  seq: number | null;
  writeDate: Date | null;
  issueDate: Date | null;
  bizNo: string | null;
  partner: string | null;
  total: number;
  supplyAmount: number;
  tax: number;
  item: string | null;
  paymentDate: Date | null;
  receiptType: string | null;
  note: string | null;
}

export interface CardInput {
  useDate: Date | null;
  rawUseDate: string | null;
  domestic: string | null;
  approvalNo: string | null;
  cardNo: string | null;
  userName: string | null;
  merchant: string | null;
  content: string | null;
  saleType: string | null;
  installment: string | null;
  amount: number;
  amountUsd: number;
  status: string | null;
  category: string | null;
}

export interface BankInput {
  account: "DEPOSIT" | "WITHDRAWAL";
  txAt: Date | null;
  rawTxAt: string | null;
  summary: string | null;
  description: string | null;
  withdrawal: number;
  deposit: number;
  balance: number;
  branch: string | null;
  memo: string | null;
  category: string | null;
  note: string | null;
}

export interface ParseResult {
  invoices: InvoiceInput[];
  cards: CardInput[];
  bank: BankInput[];
  summary: { sheet: string; type: string; count: number }[];
  warnings: string[];
}

// ── 값 정규화 헬퍼 ────────────────────────────────────────

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Math.round(v);
  const n = Number(String(v).replace(/[,\s원]/g, ""));
  return isNaN(n) ? 0 : Math.round(n);
}

function floatNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

function seqNum(v: unknown): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : Math.round(n);
}

// 다양한 한국식 날짜 표현을 Date로 변환
//  - Date 객체 (xlsx cellDates)
//  - "2023.11.06 10:29:30", "2023.11.06"
//  - "2024-11-22", "2024-11-22 00:00:00"
//  - "2024/11/22"
export function parseKDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    // 엑셀 시리얼 (cellDates를 못 쓴 경우 대비)
    const d = XLSX.SSF ? excelSerialToDate(v) : null;
    return d;
  }
  let s = String(v).trim();
  if (!s) return null;
  // 날짜가 아닌 메모성 텍스트(예: "손실처리 [파산]")는 무시
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  const dt = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    hh ? Number(hh) : 0,
    mm ? Number(mm) : 0,
    ss ? Number(ss) : 0
  );
  return isNaN(dt.getTime()) ? null : dt;
}

function excelSerialToDate(serial: number): Date | null {
  // 엑셀 1900 날짜체계
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const date = new Date(utcValue * 1000);
  const frac = serial - Math.floor(serial);
  const secs = Math.round(frac * 86400);
  date.setUTCSeconds(date.getUTCSeconds() + secs);
  return isNaN(date.getTime()) ? null : date;
}

// 시트를 2차원 배열(행=배열, 열=절대 인덱스 A=0)로 변환
// 주의: 시트의 데이터 범위가 B열부터 시작하면(예: 카드 시트) sheet_to_json은
// 기본적으로 B열을 인덱스0으로 내보내 열이 어긋난다. 또한 range 옵션의 동작이
// 번들 환경에 따라 달라질 수 있어, 셀 주소로부터 직접 행렬을 구성해
// 항상 A열=인덱스0 이 되도록 보장한다.
function sheetToMatrix(ws: XLSX.WorkSheet): any[][] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const out: any[][] = [];
  for (let R = 0; R <= range.e.r; R++) {
    const row: any[] = [];
    for (let C = 0; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      row.push(cell ? cell.v ?? null : null);
    }
    out.push(row);
  }
  return out;
}

// ── 헤더 기반 열 해석 ──────────────────────────────────────
// 엑셀 라이브러리/환경에 따라 빈 선행 열(A) 유지 여부가 달라
// 고정 열 인덱스는 어긋날 수 있다. 따라서 헤더 텍스트로 열을 찾는다.

// 공백/줄바꿈/괄호를 제거한 정규화 (시트명·헤더 공통)
function norm(name: string): string {
  return String(name ?? "")
    .replace(/[\s\r\n]+/g, "")
    .replace(/[()（）]/g, "")
    .toLowerCase();
}

// 지정한 키워드들을 모두 포함하는 헤더 행을 찾는다 (0-based 인덱스, 없으면 -1)
function findHeaderRow(rows: any[][], keywords: string[], maxScan = 8): number {
  const keys = keywords.map(norm);
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const cells = (rows[i] ?? []).map((c) => norm(String(c ?? "")));
    if (keys.every((k) => cells.some((c) => c.includes(k)))) return i;
  }
  return -1;
}

// 헤더 행에서 라벨 → 열 인덱스 맵 생성
function headerIndex(headerRow: any[]): { find: (...aliases: string[]) => number } {
  const cols = (headerRow ?? []).map((c) => norm(String(c ?? "")));
  return {
    // 별칭 중 하나라도 헤더에 포함되면 그 열 인덱스 반환 (없으면 -1)
    find: (...aliases: string[]) => {
      const al = aliases.map(norm);
      for (let i = 0; i < cols.length; i++) {
        if (cols[i] && al.some((a) => cols[i].includes(a))) return i;
      }
      return -1;
    },
  };
}

function at(row: any[], idx: number): unknown {
  return idx >= 0 ? row[idx] : null;
}

// ── 시트별 파서 (헤더 기반) ────────────────────────────────

function parseInvoiceSheet(
  rows: any[][],
  direction: "SALES" | "PURCHASE",
  taxType: "TAXABLE" | "TAX_FREE",
  hasWriteDate: boolean
): InvoiceInput[] {
  const out: InvoiceInput[] = [];
  const partnerKey = direction === "PURCHASE" ? "매입처" : "매출처";
  const hr = findHeaderRow(rows, ["합계", "공급가액", partnerKey]);
  if (hr < 0) return out;
  const h = headerIndex(rows[hr]);
  const c = {
    month: h.find("월"),
    seq: h.find("번호"),
    writeDate: h.find("작성일"),
    issueDate: h.find("발행일"),
    bizNo: h.find("사업자번호", "사업자등록번호"),
    partner: h.find(partnerKey, "거래처"),
    total: h.find("합계"),
    supply: h.find("공급가액"),
    tax: h.find("세액"),
    item: h.find("품명"),
    payDate: h.find("입금일"),
    receipt: h.find("영수/청구", "영수청구"),
    note: h.find("비고"),
  };

  for (let i = hr + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const partner = str(at(r, c.partner));
    const total = num(at(r, c.total));
    if (!partner && total === 0 && !str(at(r, c.item))) continue;
    out.push({
      direction,
      taxType,
      monthCode: str(at(r, c.month)),
      seq: seqNum(at(r, c.seq)),
      writeDate: hasWriteDate ? parseKDate(at(r, c.writeDate)) : null,
      issueDate: parseKDate(at(r, c.issueDate)),
      bizNo: str(at(r, c.bizNo)),
      partner,
      total,
      supplyAmount: num(at(r, c.supply)),
      tax: num(at(r, c.tax)),
      item: str(at(r, c.item)),
      paymentDate: parseKDate(at(r, c.payDate)),
      receiptType: hasWriteDate ? str(at(r, c.receipt)) : null,
      note: str(at(r, c.note)),
    });
  }
  return out;
}

function parseCardSheet(rows: any[][]): CardInput[] {
  const out: CardInput[] = [];
  const hr = findHeaderRow(rows, ["이용가맹점명", "승인번호"]);
  if (hr < 0) return out;
  const h = headerIndex(rows[hr]);
  const c = {
    useDate1: h.find("이용일자(년도)", "이용일자년도"),
    useDate0: h.find("이용일자"),
    domestic: h.find("국내/해외", "국내해외"),
    approval: h.find("승인번호"),
    card: h.find("이용카드"),
    user: h.find("사용자명"),
    merchant: h.find("이용가맹점명", "가맹점"),
    content: h.find("사용내용", "사용 내용"),
    saleType: h.find("매출구분"),
    installment: h.find("할부개월"),
    amount: h.find("승인금액/취소", "승인금액(원)", "승인금액"),
    usd: h.find("승인금액(usd)", "usd"),
    status: h.find("접수/취소", "접수취소"),
  };
  // "승인금액" 과 "승인금액(USD)" 가 동시에 매칭될 수 있어 USD 열은 제외
  const amountCol = c.amount === c.usd ? -1 : c.amount;

  for (let i = hr + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const merchant = str(at(r, c.merchant));
    const amount = num(at(r, amountCol));
    const rawFull = str(at(r, c.useDate1));
    const rawShort = str(at(r, c.useDate0));
    if (!merchant && amount === 0 && !rawFull && !rawShort) continue;
    out.push({
      useDate: parseKDate(at(r, c.useDate1)) ?? parseKDate(at(r, c.useDate0)),
      rawUseDate: rawFull ?? rawShort,
      domestic: str(at(r, c.domestic)),
      approvalNo: str(at(r, c.approval)),
      cardNo: str(at(r, c.card)),
      userName: str(at(r, c.user)),
      merchant,
      content: str(at(r, c.content)),
      saleType: str(at(r, c.saleType)),
      installment: str(at(r, c.installment)),
      amount,
      amountUsd: floatNum(at(r, c.usd)),
      status: str(at(r, c.status)),
      category: null,
    });
  }
  return out;
}

function parseBankSheet(rows: any[][], account: "DEPOSIT" | "WITHDRAWAL"): BankInput[] {
  const out: BankInput[] = [];
  const hr = findHeaderRow(rows, ["거래일시", "적요", "취급점"]);
  if (hr < 0) return out;
  const h = headerIndex(rows[hr]);
  const c = {
    txAt: h.find("거래일시"),
    summary: h.find("적요"),
    desc: h.find("기재내용"),
    withdrawal: h.find("지급"),
    deposit: h.find("입금"),
    balance: h.find("거래후잔액", "잔액"),
    branch: h.find("취급점"),
    memo: h.find("메모"),
    account: h.find("계정"),
    accounting: h.find("회계"),
  };

  for (let i = hr + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const rawTx = str(at(r, c.txAt));
    const summary = str(at(r, c.summary));
    const desc = str(at(r, c.desc));
    const withdrawal = num(at(r, c.withdrawal));
    const deposit = num(at(r, c.deposit));
    if (!rawTx && !summary && !desc && withdrawal === 0 && deposit === 0) continue;
    const category =
      account === "WITHDRAWAL"
        ? str(at(r, c.accounting)) ?? str(at(r, c.account))
        : null;
    out.push({
      account,
      txAt: parseKDate(at(r, c.txAt)),
      rawTxAt: rawTx,
      summary,
      description: desc,
      withdrawal,
      deposit,
      balance: num(at(r, c.balance)),
      branch: str(at(r, c.branch)),
      memo: str(at(r, c.memo)),
      category,
      note: null,
    });
  }
  return out;
}

// ── 메인 진입점 ───────────────────────────────────────────

export function parseWorkbook(buffer: Buffer | ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const result: ParseResult = {
    invoices: [],
    cards: [],
    bank: [],
    summary: [],
    warnings: [],
  };

  const sheetMap = new Map<string, XLSX.WorkSheet>();
  for (const name of wb.SheetNames) sheetMap.set(norm(name), wb.Sheets[name]);

  const pick = (target: string) => sheetMap.get(norm(target));

  const jobs: Array<{
    sheet: string;
    type: string;
    run: (m: any[][]) => void;
  }> = [
    {
      sheet: "매출(과세)",
      type: "매출계산서",
      run: (m) => result.invoices.push(...parseInvoiceSheet(m, "SALES", "TAXABLE", false)),
    },
    {
      sheet: "매출(면세)",
      type: "매출계산서",
      run: (m) => result.invoices.push(...parseInvoiceSheet(m, "SALES", "TAX_FREE", false)),
    },
    {
      sheet: "과세계(입)",
      type: "매입계산서",
      run: (m) => result.invoices.push(...parseInvoiceSheet(m, "PURCHASE", "TAXABLE", true)),
    },
    {
      sheet: "면세계(입)",
      type: "매입계산서",
      run: (m) => result.invoices.push(...parseInvoiceSheet(m, "PURCHASE", "TAX_FREE", true)),
    },
    {
      sheet: "우리카드및기타지출",
      type: "카드사용내역",
      run: (m) => result.cards.push(...parseCardSheet(m)),
    },
    {
      sheet: "입금통장",
      type: "통장거래",
      run: (m) => result.bank.push(...parseBankSheet(m, "DEPOSIT")),
    },
    {
      sheet: "출금통장",
      type: "통장거래",
      run: (m) => result.bank.push(...parseBankSheet(m, "WITHDRAWAL")),
    },
  ];

  for (const job of jobs) {
    const ws = pick(job.sheet);
    if (!ws) {
      result.warnings.push(`시트 "${job.sheet}" 를 찾지 못해 건너뜀`);
      continue;
    }
    const before =
      result.invoices.length + result.cards.length + result.bank.length;
    job.run(sheetToMatrix(ws));
    const after =
      result.invoices.length + result.cards.length + result.bank.length;
    result.summary.push({ sheet: job.sheet, type: job.type, count: after - before });
  }

  return result;
}
