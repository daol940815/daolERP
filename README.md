# daolERP

단일 법인 전용 ERP — 첫 모듈로 **근태 관리 시스템**을 구축 중입니다.

- 기획서: [docs/attendance/근태관리_기획서_초안.md](docs/attendance/근태관리_기획서_초안.md)
- 설계 원칙: 단일 법인(멀티테넌트 미채택), Master → Transaction → Engine → Snapshot, User/Employee 분리

## 구조 (pnpm 모노레포)

```
apps/api          NestJS + Prisma + PostgreSQL (백엔드)
apps/web          React + Vite + TypeScript (프론트엔드)
packages/shared   API/Web 공유 타입·상수
```

## 개발 환경 실행

```bash
# 0) 준비물: Node 22+, pnpm, PostgreSQL 16 (또는 docker compose up -d postgres)
pnpm install
cp .env.example .env && cp .env.example apps/api/.env

# 1) DB 마이그레이션 + 시드
cd apps/api
pnpm db:migrate        # prisma migrate dev
pnpm db:seed           # 역할/권한, 기본 코드, 관리자 계정, 설정, 스케줄러 작업

# 2) 실행 (루트에서)
pnpm dev:api           # http://localhost:3000/api
pnpm dev:web           # http://localhost:5173 (API 프록시 포함)
```

초기 관리자 계정: `admin@daolerp.local` / `admin1234!` (최초 로그인 후 변경)

## 개발 진행 상황

| 단계 | 내용 | 상태 |
|---|---|---|
| M1 | 공통 도메인 (사용자/직원/조직/권한/로그인/접속 로그), 시스템 설정, 스케줄러 골격, 화면 골격 | ✅ 완료 |
| M2 | 근무정책·연차정책·휴가유형·휴일 관리, 정책 배정, 버전 관리 | ✅ 완료 |
| M3 | 근무일정 (자동 생성/조정/재생성) + 승인 모듈 골격 | ✅ 완료 |
| M4 | 출퇴근 이벤트, 보정 신청·승인, 근태 계산 엔진, 첨부파일 | ✅ 완료 |
| M5 | 휴가 (연차 발생/소멸, 신청·승인, 잔여 관리, 촉진) | ✅ 완료 |
| M6 | 초과근무, 52시간 모니터링, 알림 아웃박스, 퇴사 프로세스 | ✅ 완료 |
| M7 | 월 마감 (검증+스냅샷), 통계/리포트, 관리자 대시보드, Excel Import/Export | ✅ 완료 |
| M8 | 통합 테스트, 실데이터 검증, 배포 | 예정 |
