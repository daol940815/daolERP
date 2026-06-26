// 도메인 상수 및 한글 라벨 정의

export const INVOICE_DIRECTION = {
  SALES: "매출",
  PURCHASE: "매입",
} as const;
export type InvoiceDirection = keyof typeof INVOICE_DIRECTION;

export const INVOICE_TAX_TYPE = {
  TAXABLE: "과세",
  TAX_FREE: "면세",
} as const;
export type InvoiceTaxType = keyof typeof INVOICE_TAX_TYPE;

export const BANK_ACCOUNT = {
  DEPOSIT: "입금통장",
  WITHDRAWAL: "출금통장",
} as const;
export type BankAccount = keyof typeof BANK_ACCOUNT;

// 우리은행 계좌번호 (인덱스 시트 기준)
export const BANK_ACCOUNT_NUMBERS: Record<BankAccount, string> = {
  DEPOSIT: "1005-004-585558",
  WITHDRAWAL: "1005-804-575410",
};
