-- 066: ERP 별칭 등록 대기 관리 — 제외 플래그
-- 거래처 연동 재정비 2단계: ERP 업로드가 만든 별칭 중 거래처로 관리하지 않을
-- 표기('개인' 등 비실체)를 등록 대기 목록에서 제외 처리하기 위한 컬럼.
alter table erp_vendor_aliases
  add column if not exists excluded boolean not null default false;

comment on column erp_vendor_aliases.excluded is
  '거래처 관리 제외(비실체 표기 등) — 등록 대기 목록에서 숨김';
