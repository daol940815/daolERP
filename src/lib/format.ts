// 숫자/날짜 포맷 유틸

export function formatWon(value: number | null | undefined): string {
  if (value == null) return "";
  return value.toLocaleString("ko-KR");
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// <input type="date"> 용 값 (yyyy-mm-dd), null이면 빈 문자열
export function toDateInput(value: Date | string | null | undefined): string {
  return formatDate(value);
}

// 사용자 입력 문자열(숫자, 콤마 포함 가능)을 정수로
export function parseWon(input: string | number | null | undefined): number {
  if (input == null || input === "") return 0;
  if (typeof input === "number") return Math.round(input);
  const n = Number(String(input).replace(/[,\s원]/g, ""));
  return isNaN(n) ? 0 : Math.round(n);
}
