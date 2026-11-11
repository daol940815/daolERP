# DB 정기 백업 트랙

마이그레이션 없음. 서버 이상 · 해킹 · 실수로 운영 데이터가 사라질 때를 대비한 정기 백업과 복원 절차.
2026-11-11 사용자 요청("특수한 상황을 대비하여 DB를 주기적으로 백업", 별개 작업으로 진행)으로 신설.

## 한눈에

| 항목 | 내용 |
|---|---|
| 무엇을 | 운영 DB 전체(업무 표 전부 + 로그인 계정 auth + 파일 목록 storage) + 파일 저장소의 모든 파일(첨부 · 발주서 첨부 · 명단 등 모든 버킷) |
| 형식 | Supabase 공식 백업 형식 3개 파일(roles.sql · schema.sql · data.sql) — 공식 복원 절차를 그대로 쓸 수 있다 |
| 언제 | 매일 03:00(한국 시간). GitHub 사정으로 수십 분 늦게 시작될 수 있다 |
| 어디에 | GitHub Actions 아티팩트(이 저장소의 Actions 탭), `daolerp-backup-YYYYMMDD-HHMM` |
| 얼마나 | GitHub 14일(`.github/workflows/db-backup.yml`의 `RETENTION_DAYS`) + 회사 PC 자동 보관 최근 60개 · 월별 12개월(아래) |
| 암호화 | AES-256(gpg 대칭). 암호 `BACKUP_PASSPHRASE` 없이는 열 수 없다 |
| 복원 시험 | 매주 월 05:00, 가장 최근 백업을 빈 Supabase(GitHub 서버 안 임시)에 실제로 복원해 표별 행 수 · 파일 수를 대조 |
| 실패 알림 | GitHub가 실패 메일을 보낸다(일정 실행은 워크플로를 마지막으로 바꾼 계정으로) |

파일: `.github/workflows/db-backup.yml` · `.github/workflows/db-restore-test.yml` · `scripts/backup/`
(`dump-db.sh` 덤프 · `backup-storage.mjs` 파일 복사 · `pack.sh`/`unpack.sh` 암호화 묶기/풀기 ·
`restore-test.sh` 복원 시험 · `restore-storage.mjs` 비상 시 파일 올리기 · `check-secrets.sh` 설정 확인 · `common.sh`).

## 중요: 저장소가 공개(public)다 — 2026-11-11 확인

- 이 저장소는 공개 상태다. 공개 저장소의 Actions 아티팩트와 실행 로그는 GitHub에 로그인한 누구나 볼 수 있다.
- 그래서 백업은 반드시 암호화하고, 로그에는 합계(표 수 · 행 수 · 용량)만 찍는다(표 이름별 건수 · 파일 이름은 암호화 묶음 안에만).
- 암호가 약하면 백업 파일을 받아 간 사람이 시간을 들여 풀 수 있다 → **암호는 20자 이상 필수**(짧으면 실행이 실패하도록 막았다).
- 권고: 저장소를 비공개(private)로 바꾸는 것. 백업과 별개로 ERP 코드 전체 · `db-snapshots/` 자료가 지금 누구에게나 보인다.
  비공개로 바꾸면 무료 한도가 생긴다(Actions 월 2,000분 · 아티팩트 저장 500MB). 예상 사용: 백업 하루 약 3~5분 + 복원 시험
  주 약 10분 = 월 200분 안팎. 저장 용량은 "백업 1개 크기 × 14"가 500MB를 넘지 않아야 한다 — 첫 실행 뒤 크기를 보고 판단.
  Vercel 배포는 비공개 저장소도 그대로 된다. **2026-11-11 사용자 결정: 비공개로 전환**(전환은 사용자가 GitHub 설정에서 직접 —
  Settings → General → 맨 아래 Danger Zone → Change repository visibility → Make private).
  비공개 뒤에도 로그에 합계만 찍는 규칙은 유지한다(나중에 다시 공개되거나 협업자가 늘어도 안전하게).

## 처음 설정 (사용자가 할 일, 한 번만)

GitHub 저장소 → Settings → Secrets and variables → Actions → **New repository secret** 으로 아래 3개를 넣는다.

1. `SUPABASE_DB_URL` — DB 접속 주소
   - Supabase 대시보드 → 프로젝트 → 위쪽 **Connect** 버튼 → **Session pooler** 의 주소를 복사
     (`postgresql://postgres.<프로젝트ID>:[YOUR-PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres` 모양).
   - `[YOUR-PASSWORD]` 를 DB 비밀번호로 바꿔 넣는다(대괄호까지 지운다).
   - DB 비밀번호를 모르면: Project Settings → Database → **Reset database password**. 우리 앱은 DB 비밀번호가 아니라
     API 키로 접속하므로 바꿔도 화면에는 영향이 없다.
   - "Direct connection" · "Transaction pooler(6543)" 주소는 쓰지 않는다(GitHub 서버에서 접속이 안 되거나 덤프가 안 됨).
2. `SUPABASE_SERVICE_ROLE_KEY` — 파일 저장소 복사용. Vercel 환경변수의 같은 이름 값과 같다
   (Supabase → Project Settings → API Keys 의 secret 키).
3. `BACKUP_PASSPHRASE` — 백업 암호. 20자 이상, 예: 단어 4~5개 + 숫자.
   **이 암호를 잃으면 백업은 전부 쓸모없다.** 종이에 적어 회사 금고에 1부, 사장님 또는 총괄 1부. 채팅 · 메일에 남기지 않는다.
   (프로젝트 주소를 따로 쓰고 싶을 때만 선택 비밀값 `SUPABASE_URL` — 보통은 자동으로 알아낸다.)

넣은 뒤: 저장소 **Actions** 탭 → 왼쪽 **DB 정기 백업** → **Run workflow** → 초록 체크가 뜨면 →
**백업 복원 시험** → **Run workflow** → 초록 체크가 뜨면 설정 끝. 실패하면 실행 화면 주소를 Claude 세션에 주면 된다.

## 보기용 엑셀 — 2026-11-11 사용자 요청으로 추가

백업 묶음 안 `excel/` 폴더에 앱 화면의 "엑셀 다운로드"와 **같은 모양**의 엑셀이 함께 들어간다(전체 기간 = `DATA_START` ~ 백업일).
앱 내보내기 코드(`app/api/**/export/route.ts`)를 그대로 묶어 돌리므로(`scripts/backup/excel/`), 화면 다운로드 열이 바뀌면 백업 엑셀도 따라 바뀐다.
앱 코드는 고치지 않고 로그인 확인(`@/lib/user-role`)과 쿠키(`next/headers`)만 백업 계정용 대체 파일로 바꿔 끼운다. 읽기만 한다.

| 파일 | 화면 |
|---|---|
| 01_주문현황 | 주문 현황 엑셀 다운로드(품목 행 단위, 매입가 · 마진 포함) |
| 02_매출처 · 03_거래처담당자 · 04_품목 · 05_ERP별칭 | 매출처 허브 · 거래처 담당자 · 품목 관리 · 별칭 |
| 11~16 | 통장 내역 · 계산서 · 카드 지출 · 카드 매출 · 현금영수증 · 분개 |
| 17 · 18 | 기초잔액 · 거래처 기초잔액 |
| 21 · 22 | 미수금 · 미지급금(백업일 기준) |

- 만든 결과(성공 수 · 못 만든 것과 이유)는 `excel/_만들기결과.txt`. 엑셀을 못 만들어도 DB 백업은 정상 보관된다(실행 화면에 경고만).
- 엑셀은 DB 덤프 몇 분 뒤 운영 DB에서 만든다 — 새벽이라 사실상 같은 시점이지만 정확한 기준은 DB 덤프다.
- **엑셀 다운로드가 없는 화면은 백업 엑셀도 없다.** 2026-11-11 확인: 상담일지 · 업무일지 · 근태 · 업무 요청은 앱에 엑셀 다운로드가 없다.
  그 데이터도 DB 백업에는 들어 있으므로, 필요하면 Claude 세션에 요청해 뽑거나, 화면에 엑셀 다운로드를 만들면 여기 목록에 한 줄 추가로 자동 포함된다.
- **새 엑셀 다운로드를 만들면 `scripts/backup/excel/run.ts` 의 `EXPORTS` 에 한 줄 추가할 것.**
- 로컬 시험(2026-11-11): 모의 DB 서버로 15종 실행 — 14종 생성(품목은 모의 자료 없음), 주문 현황은 앱 다운로드와 같은 열 순서 · 한글 열 이름 확인, 쓰기 요청 없음 확인.

## 로컬(회사 PC) 자동 보관 — 2026-11-11 사용자 요청으로 추가

매일 켜져 있는 회사 PC(서버가 있으면 서버)가 GitHub의 암호화 백업을 매일 받아 폴더에 쌓는다. 백업은 계속 GitHub가 만들고 PC는 받아서 보관만 한다.
스크립트: `scripts/backup/windows/pull-backups.ps1`(받기) · `install-task.ps1`(작업 스케줄러 등록). 윈도우 기본 PowerShell만 쓴다(설치할 것 없음).

- 매일 10:00 실행. 그 시각에 PC가 꺼져 있었으면 켜진 뒤 바로 실행하고, 밀린 날 것까지 받는다(GitHub 14일 보관 안에 있는 것만).
- 기본 폴더 `D:\daolERP-backup`: 최근 60개(약 두 달) + `monthly\`에 달마다 첫 백업 1개씩 12개월.
- 암호화된 그대로 저장한다. 실행 기록은 폴더의 `pull-backups.log`.

처음 설정(한 번만):
1. GitHub 토큰 만들기: GitHub 오른쪽 위 프로필 → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** →
   Generate new token. 이름 `daolERP 백업 받기`, 만료 1년, Repository access는 **Only select repositories → daolERP**,
   Permissions → Repository permissions → **Actions: Read-only**(나머지는 그대로 없음). 만든 토큰을 복사.
   만료일을 달력에 적어 두고 그 전에 새 토큰으로 2번을 다시 한다.
2. 두 스크립트를 한 폴더(예: `C:\daolERP-backup-tool`)에 넣고, 그 폴더에서 PowerShell을 열어
   `powershell -ExecutionPolicy Bypass -File .\pull-backups.ps1 -SetToken` → 토큰 붙여 넣기.
   토큰은 이 PC · 이 윈도우 계정에서만 풀리게 암호화해 저장된다.
3. `powershell -ExecutionPolicy Bypass -File .\install-task.ps1 -Dest D:\daolERP-backup` → 등록과 동시에 한 번 받아 본다.
   D 드라이브가 없으면 `-Dest`에 다른 폴더를 준다.
4. 확인: 폴더에 `daolerp-backup-….tar.gz.gpg`가 생기고 `pull-backups.log` 마지막 줄이 "완료"면 끝.

이 PC가 고장 나도 GitHub · 백업 암호가 있으면 다른 PC에서 다시 받을 수 있다. 반대로 GitHub 계정이 사라져도 이 폴더가 남는다.
PC 디스크 하나만 믿지 말고, 가끔(분기 1회 등) `monthly\` 폴더를 외장 디스크에도 복사해 두면 더 안전하다.

## 월 1회 회사 보관 (로컬 자동 보관을 쓰지 않을 때, 매월 첫 업무일 권장)

GitHub 계정 자체가 털리거나 지워지는 경우까지 대비하려면 GitHub 밖에도 한 부 있어야 한다.

1. Actions → DB 정기 백업 → 가장 최근 초록 실행 → 아래 **Artifacts** 에서 `daolerp-backup-…` 내려받기(zip).
2. 회사 서버(또는 외장 디스크)의 백업 폴더에 그대로 보관. 암호화되어 있으므로 풀지 않고 둔다.
3. 12개월치를 남기고 오래된 것부터 지운다(권장).

## 백업 파일 열기 (윈도우 PC)

1. 받은 zip을 풀면 `daolerp-backup-….tar.gz.gpg` 1개가 나온다.
2. Gpg4win(무료) 설치 → Kleopatra → 파일 → **복호화/검증** → 백업 암호 입력 → `….tar.gz` 생성.
3. `.tar.gz` 를 7-Zip 등으로 풀면 `MANIFEST.txt`(요약) · `db/`(roles · schema · data .sql, 표별 건수 `row-counts.tsv`) ·
   `storage/`(버킷별 파일 원본) · `excel/`(보기용 엑셀)이 나온다. 첨부 파일 하나만 필요하면 `storage/` 에서, 주문 현황 · 통장 내역 등을
   보려면 `excel/` 에서 바로 연다.
   (리눅스 · 맥: `BACKUP_PASSPHRASE=… bash scripts/backup/unpack.sh <파일> <폴더>`)

## 복원 (비상 시)

원칙: 망가진 프로젝트에 덮어쓰지 않고 **새 Supabase 프로젝트에 복원**한 뒤 확인하고 앱을 옮긴다(원본 보존 원칙과 같음).
Claude 세션에 "백업 복원"을 요청하면 아래 순서로 진행한다. 수동으로 할 때:

1. Supabase에서 새 프로젝트 생성(리전 Seoul, ap-northeast-2 — Vercel 함수 리전 icn1 과 맞춰야 화면이 느려지지 않는다).
2. 백업을 풀고(위) 새 프로젝트의 Session pooler 주소로 공식 절차 실행:
   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file db/roles.sql --file db/schema.sql \
     --command 'SET session_replication_role = replica' \
     --file db/data.sql --dbname "<새 프로젝트 Session pooler 주소>"
   ```
3. 파일 올리기: `SUPABASE_URL=https://<새ID>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<새 secret 키> node scripts/backup/restore-storage.mjs <풀어 놓은 폴더>`
4. 대조: `db/row-counts.tsv` 의 표별 건수와 새 DB 건수 비교(`scripts/backup/common.sh` 의 `count_db_rows`).
5. Vercel 환경변수 `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` 를 새 프로젝트 값으로 바꾸고 재배포.
   로그인 계정(auth.users)은 비밀번호째 복원되지만, 기존 로그인 세션은 끊기므로 전원 다시 로그인한다.
6. 백업 워크플로의 `SUPABASE_DB_URL` · `SUPABASE_SERVICE_ROLE_KEY` 비밀값도 새 프로젝트로 바꾼다.

## 한계 (솔직하게)

- 최대 하루치 손실: 03:00 이후 입력분은 다음 백업까지 없다. 분 단위 복구(PITR)는 Supabase 유료 부가 기능.
- GitHub 보관분은 GitHub 계정에 묶여 있다 → 월 1회 회사 보관이 이 위험을 덮는다.
- 대안 비교: Supabase Pro(월 25달러)는 자동 일일 백업 7일 보관을 주지만 파일 저장소 파일은 포함하지 않고, 같은 Supabase 계정 안에
  있다. 이 트랙의 백업은 Pro로 올려도 계속 의미가 있다(계정 밖 사본 · 파일 포함 · 매주 복원 시험).
- 복원 시험의 임시 Supabase는 최신 버전이라 운영과 내부 버전이 조금 다를 수 있다. 시험이 실패하면 백업 자체 문제인지
  버전 차이인지 로그로 구분해 고친다.

## 미결

- 저장소 비공개 전환 실행 확인(2026-11-11 결정, 사용자가 GitHub 설정에서 전환). 전환 뒤 첫 백업 크기로 500MB 한도 대비 보관 기간 재검토.
- 첫 실행 결과(백업 크기 · 소요 시간 · 복원 시험 통과) 기록.
- 로컬 자동 보관을 둘 PC 결정 · 설정 완료 확인. PowerShell 스크립트는 이 환경에 윈도우가 없어 실행 시험을 못 했다 — 첫 설정 때 로그로 확인.

## 이력

- 2026-11-11 구축: 일일 백업 + 주간 복원 시험 워크플로, 스크립트 로컬 검증(시험용 PostgreSQL로 행 수 세기 · 대조,
  모의 저장소 서버로 파일 복사/올리기 · 실패 처리, 암호화 묶기/풀기 · 틀린 암호 거부, 설정 확인 오류 문구).
  실제 운영 DB · Supabase CLI 덤프 · 임시 Supabase 복원은 이 환경에서 돌릴 수 없어 첫 GitHub 실행으로 확인한다.
- 2026-11-11 로컬(회사 PC) 자동 보관 추가: `scripts/backup/windows/` — 윈도우 작업 스케줄러가 매일 GitHub 백업을 받아 보관
  (최근 60개 + 월별 12개월, 토큰은 Actions 읽기 전용 · DPAPI 암호화 저장).
- 2026-11-11 보기용 엑셀 추가: 백업 묶음 `excel/` — 앱 엑셀 다운로드 15종을 같은 코드로 생성(`scripts/backup/excel/`). 상담일지 등은 앱에 다운로드가 없어 제외.
