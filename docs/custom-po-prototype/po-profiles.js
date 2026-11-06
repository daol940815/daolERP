/* 매입처별 프로필 (시안) — 업체 추가 = 이 배열에 1개 추가 + 양식 파일 1개.
 * 값 표기: '{o.필드}' 주문, '{it.필드}' 품목, '{r.필드}' 수령인, '{qty}' 이 행 수량, '{n}' 행 번호, '{C.tel}' 회사 고정값.
 * 함수로 쓰면 계산 값. undefined(키 없음) = 양식 원래 값 유지. '' = 비움.
 * [확인] 표시 = 샘플에서 확인 못 한 규칙(가정) — 사용자 확인 후 확정.
 */
;(function (root) {
  'use strict'
  const tel = o => o.staff_phone || ''

  const PROFILES = [
    // ── 1. 깨끗한나라 (시트명 '한국에프앤씨') — 품목 목록 인쇄형 + 수식 ──────────
    {
      key: 'kleannara',
      label: '깨끗한나라 발주서',
      template: '깨끗한나라_발주서.xlsx',
      match: v => /깨끗한나라|한국에프앤씨/.test(v.replace(/\s+/g, '')),
      grouping: 'order',                       // 납품처 칸이 1개 → 주문 1건당 파일 1개
      needsPrice: false,                       // 단가는 양식에 인쇄돼 있음 (새 품목만 기입)
      // [확인] 파일명: 발송본 '2026-10-29_(한글 미확인)_NO.1' — 업로드 과정에서 한글이 지워져 중간 부분 미확인
      fileName: ({ o, seq, f }) => `${f.date(o.order_date, 'YYYY-MM-DD')}_깨끗한나라 발주서_NO.${seq}`,
      sheets: [{
        name: '한국에프앤씨',
        cells: {
          // C3 공급처 '깨끗한나라' · C4 판매처 '다올커머스 210807' · E5 TEL · E6 FAX = 양식 고정 (유지)
          // E3 주문일 = 원본 수식 =TODAY() 유지 [확인] 파일을 여는 날짜로 바뀜
          C5: '{o.customer}',                                    // 납품처 = 은행 + 지점
          C6: ({ o, f }) => f.shipLabel(o.ship_kind),            // 지점/개별/샘플 → '지점배송'
          // E4 납품요청일: 발송본은 날짜가 아니라 고정 문구('영업시간 내 배송 부탁드리며, 주말은 피해주세요') → 양식 값 유지 [확인] 출고요청일을 쓸지
          // C27 배송메모 = 주소 + 납품처 / 담당자 직함님 + 연락처 (발송본 그대로의 2줄 관례)
          C27: ({ o, f }) => {
            const s = o.ship || {}
            return `${[s.addr1, s.addr2, o.customer].filter(Boolean).join(' ')}\n${f.honor(o.manager_name, o.manager_title)} ${o.manager_phone || ''}`.trim()
          },
        },
        catalog: {
          startRow: 9, endRow: 24,               // 인쇄된 품목 16행
          codeCol: 'B', nameCol: 'C', qtyCol: 'D',
          qty: ({ it }) => it.qty,               // 수량(BOX) [확인] 우리 주문 수량 단위가 BOX인지
          // [확인] 목록에 없는 품목: 합계 위에 행을 추가 (서식 · 수식 복사, 합계 범위 자동 확장)
          newRow: { A: '{n}', B: '{it.vendor_code}', C: '{it.name}', E: '{it.pack_qty}', F: '{it.unit_price}' },
        },
      }],
    },

    // ── 2. 해저식품 — 발주서 시트(다올 작성 양식) + 명단 시트(업체 송장 양식) ──────
    {
      key: 'haejeo',
      label: '해저식품 발주서 + 명단',
      template: '해저식품_발주서.xlsx',
      match: v => v.replace(/\s+/g, '').includes('해저식품'),
      grouping: 'order',
      needsPrice: true,
      // [확인] 파일명: 발송본 '260918_(한글 미확인)_.NO2' — 중간 부분 미확인
      fileName: ({ o, seq, f }) => `${f.date(o.order_date, 'YYMMDD')}_해저식품 발주서_NO${seq}`,
      sheets: [
        {
          name: '발주서_해저식품',
          cells: {
            // B2 공급처 '해저식품' · G2 업체명 '다올커머스' · E4 TEL · G4 FAX · B17 비고 문구 = 양식 고정 (유지)
            E2: ({ o }) => new Date(o.order_date + 'T00:00:00'),   // 주문일 (날짜 서식 유지)
            B3: '{o.customer}',                                     // 주문처
            E3: '{o.staff_name}',                                   // 담당자 = 다올 발주 담당
            G3: ({ o }) => tel(o),                                  // 연락처 = 발주 담당 핸드폰
            B4: ({ o, f }) => f.shipLabel(o.ship_kind),             // 지점/개별
            D5: ({ items, f }) => f.amount(items),                  // 합계금액 (발송본은 수식 없이 값) — VAT 포함 표기는 양식 그대로
            B15: ({ o }) => o.sender_name || o.customer,            // 발송인 = 보내는분 명의
            B16: '옆 시트 참고',                                     // 배송지 = 명단 시트 참고 (발송본 관례)
          },
          rows: {
            startRow: 7, endRow: 14, insertBefore: 15,   // 품목 8행 준비, 넘치면 '발송인' 행 앞에 끼워 넣음
            scope: 'item',
            columns: {
              A: '{n}', B: '{it.name}', C: '{qty}', D: '{it.unit_price}',
              E: ({ it }) => Number(it.qty || 0) * Number(it.unit_price || 0),   // 금액 = 수량 × 단가 (발송본은 값)
              F: ({ it, o, f }) => f.shipLabel(it.ship_kind || o.ship_kind),
              G: '{it.memo}',                            // [확인] 발송본 G7 '비고'(파란 글씨) — 고정 문구인지 품목 메모인지
            },
          },
        },
        {
          name: '명단_해저식품',
          rows: {
            startRow: 2, endRow: 323, scope: 'recipientItem',   // 수령인 × 품목 1행
            columns: {
              A: ({ o }) => o.sender_name || o.customer,         // 구매자 성명(보내는분 명의)
              B: ({ o }) => tel(o),                               // 구매자 전화번호 = 발주 담당 핸드폰 (발송본 관례)
              C: '', D: '',                                       // 구매자 기타연락처 · 주소 = 발송본 공란
              E: '{r.name}', F: '{r.phone}',
              G: ({ r }) => r.phone2 || r.phone,                 // [확인] 발송본은 기타연락처에 같은 번호 반복
              H: '{r.addr}', I: '{it.name}', J: '{qty}',
              K: '{r.message}', L: '', M: '',                    // 비고 · 송장번호 = 업체/회신용 공란
            },
          },
        },
      ],
    },

    // ── 3. 삼진어묵 접수내역 — 명단형 + 드롭다운 · 수식 · 숨김 시트 (발송본 없음 → 매핑 대부분 [확인]) ──
    {
      key: 'samjin',
      label: '삼진어묵 접수내역',
      template: '삼진어묵_접수내역.xlsx',
      match: v => v.replace(/\s+/g, '').includes('삼진어묵'),
      grouping: 'day',                         // [확인] 하루치를 한 파일로 모으는지 (양식이 600행 명단이라 가능)
      needsPrice: false,                       // 양식에 단가 칸 없음 (숨김 시트 품목코드에 금액)
      // D1 제목 칸 규칙 '[업체명_00월 00일 접수_제품명_수량(접수자명)]' — 파일명에 적용 [확인] 제목 칸에도 쓰는지
      fileName: ({ batch, f }) => {
        const items = batch.flatMap(b => b.items)
        const o = batch[0].order
        return `${'다올커머스'}_${f.date(o.order_date, 'MM')}월 ${f.date(o.order_date, 'DD')}일 접수_${f.firstName(items)}_${f.totalQty(items)}(${o.staff_name})`
      },
      sheets: [{
        name: '접수내역',
        rows: {
          startRow: 7, endRow: 606, scope: 'recipientItem',   // [확인] 7행 No.가 'EX' — 7행부터 쓰는지 8행부터인지
          // 한 행에 제품 1가지 (양식 메모 N3 '동일 주소지에 두 가지 이상 제품 → 하나의 행에 한 가지 제품만')
          columns: {
            // A No. = 양식에 미리 매겨진 번호 유지
            B: '{C.name}', C: '{C.tel}',                      // [확인] 접수자 성함(업체명) · 연락처 = 다올커머스
            D: ({ o }) => o.sender_name || o.customer,        // 보내는분 성함 (양식 안내: 업체명 기입 무방)
            E: ({ o }) => tel(o),                              // [확인] 보내는 분 연락처 = 발주 담당 핸드폰 (해저식품 관례 준용)
            // F 우편번호 공란, G 보내는분 주소 = 원본 수식 유지(받는분이 있으면 삼진어묵 주소 자동)
            H: '{r.name}', I: '{r.phone}', J: '{r.phone2}', K: '{r.zip}', L: '{r.addr}', M: '{r.message}',
            N: '{it.name}', O: '{it.option}', P: '{qty}',
            // Q 품목코드 = 원본 수식(VLOOKUP) 유지
          },
          copyValues: ['A'],                                  // 600행을 넘기면 No.를 이어서 매김
        },
        // 드롭다운 목록(숨김 시트 품목코드)에 없는 제품명 · 옵션 경고 — 품목코드 수식이 비게 됨
        validate: (ws, batch, warn) => {
          const wb = ws.workbook, codes = wb.getWorksheet('품목코드')
          const txt = v => (v == null ? '' : v.richText ? v.richText.map(t => t.text).join('') : String(v))
          if (!codes) return
          const names = [], opts = []
          for (let r = 2; r <= 26; r++) names.push(txt(codes.getCell(`A${r}`).value).trim())
          for (let r = 2; r <= 4; r++) opts.push(txt(codes.getCell(`D${r}`).value).trim())
          for (const b of batch) for (const it of b.items) {
            if (!names.includes(String(it.name).trim())) warn(`${it.name}: 삼진어묵 품목명 목록에 없음 — 품목코드가 비게 됩니다(품목 마스터 매입처 품명 확인)`)
            if (it.option && !opts.includes(String(it.option).trim())) warn(`${it.name}: 옵션 '${it.option}'이 목록(${opts.join(' / ')})에 없음`)
          }
        },
      }],
    },

    // ── 4. 명단형 공통 양식(대한통운 송장) — 업체 미확인 빈 양식, 기본값 행(다올커머스) 관례 ──
    {
      key: 'myeongdan',
      label: '명단형 양식 (대한통운 송장 · 업체 확인 필요)',
      template: '명단형_대한통운_빈양식.xlsx',
      match: v => v.includes('명단형'),
      grouping: 'day',
      needsPrice: false,
      fileName: ({ batch, f }) => `${f.date(batch[0].order.order_date, 'YYMMDD')}_명단형 발주_${batch.length}건`,
      sheets: [{
        name: 'Sheet1',
        rows: {
          startRow: 2, endRow: 25, scope: 'recipientItem',
          columns: {
            // 빈 양식 2행에 미리 적힌 구매자(다올커머스 · 대표번호 · 회사 주소)를 모든 행에 반복 [확인]
            A: '{C.name}', B: '{C.tel}', C: '', D: '경기도 고양시 일산서구 덕이동 1234-1',
            E: '{r.name}', F: '{r.phone}', G: '{r.phone2}', H: '{r.addr}', I: '{it.name}', J: '{qty}', K: '{r.message}', L: '',
          },
        },
      }],
    },
  ]

  if (typeof module !== 'undefined' && module.exports) module.exports = PROFILES
  else root.PoProfiles = PROFILES
})(typeof window !== 'undefined' ? window : globalThis)
