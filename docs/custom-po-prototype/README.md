# 매입처 자체 발주서 자동 생성 — 시안 (2026-11-06)

통합 주문 데이터를 한 번 입력하면, 매입처마다 그 업체의 **원본 양식 파일**에 값을 채운 발주서 엑셀을 만든다.
서식 · 병합 · 수식 · 드롭다운 · 숨김 시트 · 로고 · 메모는 원본 그대로 둔다. **ERP 미적용 시안** — 서버 코드 아님.

- 실행 시안(브라우저): https://claude.ai/artifact/MnZP5kRFELb4eeicvXZtoj (소유자 비공개) · 같은 파일 `자체발주서_자동생성.html`
- 분석 · 매핑표 · 확인 필요 항목: 위 페이지의 탭, 요약은 `docs/order-system-track.md` "매입처 자체 발주서 자동 생성 시안"

## 파일

| 파일 | 내용 |
|---|---|
| `po-engine.js` | 생성 엔진 (노드 · 브라우저 공용, exceljs 4.4.0). 채우기 3종 · 행 끼워 넣기(병합 · 합계 범위 · 인쇄영역 보정) · 매입처 분류 · 묶음 · 통합 입력 엑셀 읽기/쓰기 |
| `po-profiles.js` | 업체 프로필 4개 (깨끗한나라 · 해저식품 · 삼진어묵 · 명단형). `[확인]` = 샘플로 확인 못 한 가정 |
| `templates/` | 원본 양식 4개 — 개인정보 제거. 깨끗한나라 · 해저식품은 발송본에서 입력 칸만 비워 복원, 삼진어묵은 .xls → .xlsx 변환(LibreOffice) 후 글꼴 · 서식 글자 복구 |
| `통합주문입력_샘플.xlsx` | 통합 주문 입력 양식 (시트: 주문 · 품목 · 수령인) + 가상 주문 4건 |
| `sample-orders.json` | 같은 가상 주문의 JSON |
| `samples/` | 가상 주문으로 생성한 업체별 발주서 6개 |
| `generate.cjs` | 명령줄 생성기 |

## 실행

```bash
cd docs/custom-po-prototype
NODE_PATH=../../my-accounting-app/node_modules node generate.cjs 통합주문입력_샘플.xlsx templates out
```

## 업체 추가

1. 빈 양식 + 실제 발송본(품목 2개 이상) 수령
2. 개인정보를 비운 양식을 `templates/`에 저장 (.xls는 .xlsx로)
3. `po-profiles.js`에 프로필 1개: 시트 이름 · `cells`(칸 → 값) · `rows`(시작 행 · 준비 마지막 행 · 꼬리 시작 행 · 행 단위 item/recipientItem · 열 → 값) 또는 `catalog`(코드 열 · 수량 열 · 새 행 규칙) · `grouping`(order/day) · `fileName`
4. 샘플 주문으로 생성 → 발송본과 칸 단위 대조 → `[확인]` 항목 확정

## 주의 (구현 시)

- openpyxl로 저장한 메모 포함 파일은 exceljs가 읽지 못함(삼진어묵) → 템플릿 손질은 exceljs로.
- LibreOffice 변환은 일부 칸을 서식 글자(richText) · 다른 글꼴로 바꿈 → 평문 · 맑은 고딕으로 복구 필요(드롭다운 목록 비교가 깨짐).
- exceljs 병합 칸은 읽기 · 쓰기가 대표 칸으로 감 → 행을 옮기기 전에 병합 해제 필수(엔진 `insertRowsBefore`).
