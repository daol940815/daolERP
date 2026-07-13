-- =====================================================
-- 064_enable_rls.sql
-- 외부 공개(임원 접속) 전 보안 보강: 전 테이블 RLS(행 수준 보안) 활성화.
--
-- 이 앱의 데이터 접근은 전부 서버 API(서비스 키)를 거친다. 브라우저에
-- 포함되는 공개 키(anon)는 로그인(auth)에만 쓰이는데, RLS가 꺼져 있으면
-- 공개 키만으로 PostgREST를 통해 모든 테이블을 읽고 쓸 수 있다.
--
-- RLS를 켜고 정책을 만들지 않으면 anon/authenticated는 기본 거부되고,
-- 서비스 키(service_role)는 RLS를 우회하므로 앱 동작에는 영향이 없다.
--
-- 주의: 이후 브라우저에서 supabase-js로 테이블을 직접 조회하는 코드를
-- 추가하려면 해당 테이블에 정책을 만들어야 한다 (현재는 그런 코드 없음).
-- =====================================================

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
