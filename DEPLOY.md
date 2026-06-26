# 🚀 daolERP 인터넷 배포 가이드 (Vercel + Neon)

비개발자도 그대로 따라 할 수 있도록 단계별로 정리했습니다.
처음 한 번만 설정하면, 이후에는 코드 수정 시 **자동으로 재배포**됩니다.

> **전체 그림**
> - **Neon** = 데이터가 저장되는 클라우드 데이터베이스(PostgreSQL) — 무료
> - **Vercel** = 프로그램(웹사이트)이 실행되는 호스팅 — 무료
> - **GitHub** = 코드가 보관되는 곳 (이미 사용 중)
>
> 소요 시간: 약 20~30분 / 비용: 무료

---

## 0단계. 준비물

- GitHub 계정 (이미 있음 — 이 저장소가 올라가 있는 곳)
- 이메일 (Neon/Vercel 가입용)

---

## 1단계. Neon 데이터베이스 만들기

1. **[https://neon.tech](https://neon.tech)** 접속 → **Sign up** (GitHub 계정으로 가입 추천)
2. 로그인 후 **Create project** 클릭
3. 설정:
   - **Project name**: `daolerp` (아무 이름이나 가능)
   - **Postgres version**: 기본값
   - **Region**: `Asia Pacific (Singapore)` 또는 가까운 지역 선택
4. **Create** 클릭
5. 생성되면 **Connection string**(연결 주소)이 나옵니다. 두 가지를 복사해 둡니다:
   - 화면의 **Connection string** 토글에서 **Pooled connection** 주소 → 메모장에 `DATABASE_URL` 로 저장
   - **Direct connection**(또는 “Connection pooling” 끈 상태) 주소 → `DIRECT_URL` 로 저장

   > 주소는 `postgresql://...neon.tech/...?sslmode=require` 형태입니다.
   > Pooled 주소에는 보통 `-pooler` 가 포함되어 있고, Direct 주소에는 없습니다.

---

## 2단계. 보안 키(AUTH_SECRET) 만들기

로그인 세션 암호화에 쓰이는 무작위 키가 필요합니다. 아래 중 한 가지로 생성하세요.

- **방법 A (Mac/Linux 터미널)**: `openssl rand -base64 32` 입력 → 나온 문자열 복사
- **방법 B (온라인)**: "random string generator" 로 32자 이상 무작위 문자열 생성
- 이 값을 메모장에 `AUTH_SECRET` 으로 저장

---

## 3단계. Vercel 프로젝트 만들기 (GitHub 연결)

1. **[https://vercel.com](https://vercel.com)** 접속 → **Sign up** (GitHub 계정으로 가입 추천)
2. **Add New... → Project** 클릭
3. **Import Git Repository** 에서 이 저장소(`daolerp`)를 선택 → **Import**
4. **Configure Project** 화면에서 **Environment Variables**(환경변수)를 등록합니다. (다음 단계)

> Framework Preset 은 자동으로 **Next.js** 로 인식됩니다. Build/Output 설정은 건드리지 않아도 됩니다.

---

## 4단계. 환경변수 등록 (가장 중요)

Vercel 의 **Environment Variables** 에 아래 6개를 입력합니다. (Name = Value 형식)

| Name | Value |
|------|-------|
| `DATABASE_URL` | 1단계의 **Pooled** 주소 |
| `DIRECT_URL` | 1단계의 **Direct** 주소 |
| `AUTH_SECRET` | 2단계에서 만든 무작위 키 |
| `ADMIN_USERNAME` | 로그인 아이디 (예: `admin`) |
| `ADMIN_PASSWORD` | 로그인 비밀번호 (강력하게!) |
| `ADMIN_NAME` | 표시 이름 (예: `관리자`) |

> ⚠️ 이 값들은 **절대 외부에 공유하지 마세요.** GitHub 코드에는 포함되지 않습니다.
> 모든 환경(Production/Preview/Development)에 적용되도록 두면 됩니다.

입력을 마치면 **Deploy** 를 누릅니다.

---

## 5단계. 자동으로 일어나는 일 (마이그레이션 · 관리자 생성)

**Deploy** 를 누르면 빌드 과정에서 다음이 **자동 실행**됩니다 (직접 할 일 없음):

1. `prisma migrate deploy` → 데이터베이스에 필요한 표(테이블) 생성
2. `prisma/seed.ts` → `ADMIN_USERNAME`/`ADMIN_PASSWORD` 로 **관리자 계정 자동 생성**
3. `next build` → 웹사이트 빌드

빌드가 끝나면 `https://(프로젝트이름).vercel.app` 주소가 발급됩니다.

---

## 6단계. 로그인 & 데이터 올리기

1. 발급된 주소에 접속 → **로그인 화면**이 나옵니다
2. 4단계에서 정한 **아이디/비밀번호**로 로그인
3. 왼쪽 메뉴 **⬆️ 엑셀 가져오기** → 기존 엑셀 업로드 → 데이터 적재 완료 🎉

> 동료에게는 **주소 + 아이디/비밀번호**만 알려주면 함께 사용할 수 있습니다.

---

## 🔁 재배포 방법 (코드/기능 수정 시)

이 저장소의 **지정 브랜치에 코드가 푸시되면 Vercel 이 자동으로 재배포**합니다.
- 따로 할 일이 없습니다. (GitHub 에 변경이 올라가면 1~2분 후 자동 반영)
- 수동 재배포가 필요하면: Vercel 프로젝트 → **Deployments → 우측 ... → Redeploy**

> 데이터베이스 구조가 바뀌는 변경(마이그레이션 추가)도 빌드 시 `migrate deploy` 가 자동 적용합니다.

---

## 🔑 관리자 비밀번호 변경

현재 관리자 비밀번호는 **Vercel 환경변수 `ADMIN_PASSWORD`** 로 관리됩니다.
1. Vercel 프로젝트 → **Settings → Environment Variables**
2. `ADMIN_PASSWORD` 값 수정 → 저장
3. **Deployments → Redeploy** (다음 배포 시 새 비밀번호로 갱신)

> 추후 “앱 안에서 비밀번호 변경 / 사용자 추가” 기능을 넣으면 환경변수 없이도 관리할 수 있습니다.

---

## 🆘 장애 발생 시 빠른 점검

| 증상 | 확인 사항 |
|------|-----------|
| 로그인 화면에서 안 넘어감 | `ADMIN_USERNAME/PASSWORD` 환경변수 확인, 재배포 후 관리자 생성됐는지 |
| "인증이 필요합니다" 계속 뜸 | `AUTH_SECRET` 이 설정돼 있는지 |
| 데이터가 안 보이거나 500 에러 | `DATABASE_URL`/`DIRECT_URL` 주소 정확한지 (Neon 대시보드에서 재확인) |
| 빌드 실패 | Vercel **Deployments → 실패한 빌드 → Logs** 에서 빨간 줄 확인 |
| Neon "compute suspended" | 무료 플랜은 미사용 시 잠자기 — 첫 접속이 느릴 수 있음(정상). 잠시 후 깨어남 |

데이터 백업·복구는 **[BACKUP.md](./BACKUP.md)** 참고.

---

## 💻 (참고) 로컬에서 개발/테스트하기

운영과 동일하게 PostgreSQL 을 사용합니다.

1. `.env.example` 을 복사해 `.env` 생성 후 값 채우기
   - 로컬 PostgreSQL 을 쓰거나, Neon 주소를 그대로 써도 됩니다.
2. 명령 실행:
   ```bash
   npm install
   npm run db:setup     # 마이그레이션 적용 + 관리자 생성
   npm run dev          # http://localhost:3000
   ```
3. 엑셀 일괄 적재(선택): `npm run import:excel -- "엑셀파일.xlsx"`
