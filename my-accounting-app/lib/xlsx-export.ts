import * as XLSX from 'xlsx'

// 행 배열을 XLSX 다운로드 응답으로 변환하는 공용 헬퍼.
// cols: 각 열 너비(wch) 배열(선택).
export function xlsxResponse(
  rows: Record<string, unknown>[],
  sheetName: string,
  cols?: number[],
): Response {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  if (cols && cols.length) ws['!cols'] = cols.map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const today = new Date().toISOString().slice(0, 10)
  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${sheetName}_${today}`)}.xlsx`,
    },
  })
}

// 여러 시트를 한 워크북으로 묶는 변형(잔액/내용 등).
export function xlsxResponseMulti(
  sheets: { name: string; rows: Record<string, unknown>[]; cols?: number[] }[],
  fileName: string,
): Response {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows)
    if (s.cols && s.cols.length) ws['!cols'] = s.cols.map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const today = new Date().toISOString().slice(0, 10)
  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${fileName}_${today}`)}.xlsx`,
    },
  })
}
