# 분개 · 원장 회계 엔진 설계 (journal-design)

> ERP의 핵심 회계 엔진. "업무를 처리하면 회계가 자동 생성되는" 구조를 목표로 한다.
> 작성일 2026-06. 본 문서 하나로 회계 엔진의 전체 구조를 이해할 수 있게 유지한다.

---

## 1. 설계 배경 및 목표

- 이 ERP는 "회계를 직접 입력하는 프로그램"이 아니라 **"업무를 처리하면 회계가 자동으로 생성되는 ERP"** 를 지향한다.
- 사용자는 **거래의 성격과 계정과목만 판단**하고, 복식분개(차변/대변)와 원장 생성은 **시스템이 자동** 처리한다.
- 장기적으로 회사의 실제 처리 데이터를 축적하여
  **자동분개 → 과거 처리 이력 추천 → AI 계정과목 추천 → AI 자동분개** 로 확장한다.

### 핵심 원칙
1. **회계 판단(업무 규칙)과 저장(엔진)을 분리한다.** 업무 규칙은 TypeScript, 저장·검증은 DB(RPC).
2. **보이는 분개 = 저장되는 분개.** 미리보기와 실제 전기는 동일한 `JournalDraft`를 사용한다.
3. **확정(confirmed) 시 전기, 확정 해제 시 전기 취소.** 거래 상태와 분개가 항상 동기화된다.
4. **멱등성.** 같은 문서는 몇 번을 전기해도 분개 1건. 재분류 시 라인만 갱신, 전표번호는 유지.

---

## 2. 전체 아키텍처

```
 업무 모듈 (TypeScript)                        저장 엔진 (PostgreSQL RPC)
 ─────────────────────                        ────────────────────────
 은행거래 / 법인카드 / (P2)세금계산서
        │
        │ buildPosting(source)   ← 업무 규칙·계정·차대변 결정
        ▼
   JournalDraft  ──────┬──────► 분개 미리보기 (확정 전 확인)
                       │
                       └──────► post_journal(draft)  ──► journal_entries
                                unpost_journal(...)        journal_lines
                                                              │
                                                              ▼
                                          계정별 원장 · 거래처별 원장 · (P2)재무제표
```

- **TypeScript(업무 모듈)**: 거래유형 판단, 계정·차대변 결정, 이력/AI 추천, 미리보기, **언제 post/unpost 할지** 결정.
- **RPC(Posting Engine)**: 균형검증·멱등성·채번·원자적 저장만. **회계 판단을 하지 않는다.**

---

## 3. Posting Engine 구조 (역할 분리)

### TypeScript — `buildPosting(source) → JournalDraft`
거래 1건에 대한 완성된 분개 초안을 만든다. 업무 규칙은 전부 여기에 있다.
(예: 은행 입금=대변 수익계정, 이체=계좌간 이동, 카드=비용/미지급금 …)

### RPC — `post_journal(draft)` / `unpost_journal(source_type, source_id)`
전달받은 초안을 **안전하게 저장**한다. DB만이 잘할 수 있는 일에 집중한다.

| RPC가 하는 일 | RPC가 하지 않는 일 |
|---|---|
| 차변합 = 대변합 균형 검증 | 어떤 계정인지 판단 |
| (source_type, source_id) 멱등성 | 차/대변 방향 판단 |
| 전표번호 채번(동시성 안전) | 이체/카드대금/부가세 규칙 |
| journal_entries / journal_lines 원자적 저장 | 이력/AI 추천 |
| 재전기 시 라인 교체(번호 유지) | "언제 전기할지" 결정 |

> 라인 단위 무결성(`amount>0`, `side IN(...)`, account/vendor FK)은 **테이블 CHECK·FK 제약**이 자동 처리한다.
> 그래서 RPC가 직접 계산하는 것은 사실상 **"차/대변 균형"** 뿐이며, 엔진은 매우 얇다.

---

## 4. JournalDraft 구조

`buildPosting()`의 산출물이자 미리보기·`post_journal`이 공유하는 단일 계약(타입).

```ts
type JournalSide = 'debit' | 'credit'

interface JournalLineDraft {
  account_id: string
  side:       JournalSide
  amount:     number        // 항상 양수
  vendor_id?: string | null // 거래처별 원장용 (선택)
  note?:      string | null
}

interface JournalDraft {
  source_type: 'bank' | 'card' | 'tax_invoice' | 'manual'
  source_id:   string       // 원천 문서 id (멱등 키)
  entry_date:  string       // 'YYYY-MM-DD'
  description: string | null
  entry_type?: 'normal' | 'adjustment' | 'closing'
  lines:       JournalLineDraft[]   // 차변≥1, 대변≥1, 합계 균형
}
```

---

## 5. 상태(State) 다이어그램

거래(transactions / card_expenses)의 상태와 분개 동기화.

```
   [Pending]  ── 계정과목 지정 ──►  [Reviewed]  ── 확정 ──►  [Confirmed]
      ▲                               ▲   │                     │
      │                               │   │ post_journal()      │
      │        ┌──────────────────────┘   ▼                     │
      │        │  계정 수정(재분류)      journal_entries          │
      │        │  → re-post(라인 교체,    journal_lines           │
      │        │     전표번호 유지)                               │
      └────────┴───────────  확정 해제(unpost_journal) ──────────┘
                              (Confirmed → Reviewed, 분개 삭제)
```

- **Pending**: 미검토(분류 전).
- **Reviewed**: 계정과목 지정됨(아직 장부 미반영).
- **Confirmed**: 확정 → **분개 생성(전기)**. 장부·원장·재무제표에 반영.
- **재분류**: Confirmed 상태에서 계정 변경 시 분개 라인 교체(전표번호 유지).
- **확정 해제(Unpost)**: Confirmed → Reviewed 로 되돌리고 분개 삭제.

---

## 6. Posting Engine 데이터 흐름도

```
 은행거래(확정)
     │
     ▼
 buildBankPosting(tx, glAccount)        ── 업무 규칙(입금/출금/이체/카드대금)
     │
     ▼
 JournalDraft
     ├──────────► 분개 미리보기 (화면: 차변/대변/금액 확인 후 확정)
     │
     └──────────► post_journal(draft)   ── RPC
                       │  ├ 균형 검증
                       │  ├ 멱등성((source_type,source_id) 조회)
                       │  ├ 전표번호 채번(document_sequences)
                       │  ├ journal_entries upsert
                       │  └ journal_lines 재작성
                       ▼
                  journal_entries / journal_lines
                       │
            ┌──────────┼───────────┐
            ▼          ▼           ▼
       계정별 원장  거래처별 원장   (P2)재무제표
   (account_id 기준) (vendor_id 기준)
```

---

## 7. 자동분개 규칙표

v1 자동분개(은행·카드). 금액은 항상 양수, 차변합 = 대변합.

| 거래 유형 | 차변 | 대변 | 금액 | 비고 |
|---|---|---|---|---|
| 은행 **입금** | 보통예금(은행계좌 GL) | 분류계정(confirmed) | amount_in | line.vendor_id = tx.vendor_id |
| 은행 **출금** | 분류계정(confirmed) | 보통예금(은행계좌 GL) | amount_out | line.vendor_id = tx.vendor_id |
| **계좌 간 이체** | 수신계좌 GL | 송금계좌 GL | 이체금액 | 손익 무접촉(transfer_pair) |
| **카드 사용** | 비용계정(confirmed) | 미지급금(2001) | 승인금액 | 미지급금 line.vendor_id = 카드사(card_accounts.vendor_id) |
| **카드대금 결제**(은행출금) | 미지급금(2001) | 보통예금 | 결제금액 | ⚠️ 비용으로 분류 금지(이중계상 방지) · (P2) 카드사 vendor 태깅 시 미지급금 상계 |
| (P2) 매출 세금계산서 | 매출채권 | 매출 + 부가세예수금 | 합계 | 부가세 분리 |
| (P2) 매입 세금계산서 | 비용/자산 + 부가세대급금 | 미지급금 | 합계 | 부가세 분리 |

### 회계상 예외 규칙 (v1 반드시 적용)
- **카드대금 이중계상 방지**: 카드 사용은 `card_expenses`에서 (차)비용/(대)미지급금으로 이미 분개됨.
  따라서 카드대금 결제 은행출금은 반드시 **미지급금**으로 분류해야 한다(비용 재계상 금지).
- **거래처 일관성**: 카드 미지급금의 상대처는 가맹점이 아니라 **카드사**다(카드사에 갚을 채무).
  `card_accounts.vendor_id`(카드사 매입처)를 미지급금 라인에 태깅한다. 가맹점명은 적요로만 남는다.
  (P2) 카드대금 결제 은행출금의 미지급금 차변에도 같은 카드사를 태깅하면 거래처별 원장에서 상계되어 채무 잔액이 정확해진다.
- **계좌 간 이체**: 수익/비용이 아니라 자산·부채 이동. `transfer_pair_id`로 식별해 GL↔GL 분개.
- **부가세**: v1 은행·카드는 **총액**으로 비용 처리(부가세 미분리). 매입세액 공제는 (P2) 세금계산서/카드매입세액에서 집계.
- **분할분개**: 한 거래를 여러 계정으로 쪼개는 건 (P2) 이후(`transaction_splits`) 검토.

---

## 8. 주요 설계 결정 이유

| 결정 | 이유 |
|---|---|
| 기존 `journal_entries`/`journal_lines` 재사용 | 복식부기 스키마가 이미 적절(차/대변, account/vendor 인덱스). 신규 테이블 불필요. |
| `source_type` + `source_id` 도입 (transaction_id는 유지) | 은행 외 카드·세금계산서·수동 등 범용 원천 지원 + 멱등 키. |
| Posting Engine을 **DB 함수(RPC)** 로 | 원자성·채번·멱등을 DB가 보장(동시성 안전). 회계 판단은 배제. |
| 업무 규칙은 **TypeScript** | 모듈 추가·테스트·AI 확장에 유리. `buildPosting`은 순수함수라 단위테스트 용이. |
| `bank_accounts.gl_account_id` | 계좌별 회계계정 매핑(보통예금/단기차입금 등) 확장. |
| 전표번호 `JV-YYYYMMDD-####`, DB 채번 | 가독성 + 동시성 충돌 없음. 재전기 시 번호 유지(추적성). |
| 확정 시 감사필드 축적 | 향후 이력추천·AI 학습 데이터(거래처/적요/금액/방향/선택계정/확정자/시각/재분류 여부). |

### 채번
- 접두사 `JV-` + 거래일(YYYYMMDD), 일자별 4자리 일련번호.
- `document_sequences(prefix, last_no)` 테이블을 `post_journal` 트랜잭션 안에서 upsert → 동시성에도 충돌 없음.

---

## 9. 향후 확장 로드맵 (AI)

```
 v1  자동분개 (은행·카드)              ← 현재 구현 범위
  │
  ▼
 v2  과거 처리 이력 기반 추천 (규칙)    ← confirmed 데이터 집계: "이 가맹점/입금자는 과거 어느 계정?"
  │
  ▼
 v3  AI 계정과목 추천 (사용자 최종 확인) ← 축적 데이터 학습
  │
  ▼
 v4  AI 자동분개 (신뢰도 높은 건 한정)
```

- 처음부터 AI가 회계를 판단하지 않는다. **실제 업무 데이터를 충분히 축적한 뒤** AI가 학습·추천하는 방향.
- v2(이력추천)는 현재의 부분문자열 키워드 분류기를 점진 대체한다(오탐 감소). v1에 추가한 **방향 가드**(입금→비용계정 금지 등)와 결합.
- 이를 위해 거래 확정 시 다음이 자연히 축적되도록 설계: 거래처명·적요·메모·금액·입출금 구분·사용자가 최종 선택한 계정·확정자·확정일시·재분류 여부.

---

## 10. 구현 순서

1. 스키마: `source_type/source_id`(+unique), `document_sequences`, `bank_accounts.gl_account_id`, 감사필드
2. Posting Engine: `post_journal` / `unpost_journal` RPC + `JournalDraft` 타입
3. 은행거래 자동분개: `buildBankPosting`(입금/출금/이체/카드대금) + 확정/해제 UX + 미리보기 + 기존 확정분 백필
4. 법인카드 자동분개: `buildCardPosting`
5. 분개장 `/journal`
6. 계정별 원장 `/ledger` (잔액누계 = SQL 윈도우함수/RPC 집계)
7. 거래처별 원장
8. 과거 처리 이력 추천(v2)
9. 기초잔액(별도 테이블 `account_opening_balances`, 회계연도별)
10. (P2) 세금계산서 자동분개  11. (P2) 수동분개

> 수동분개는 P2 이후. v1은 "업무 처리 → 자동분개" 에 집중한다.
