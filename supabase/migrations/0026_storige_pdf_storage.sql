-- =====================================================================
-- 0026_storige_pdf_storage.sql
--   인쇄 PDF 저장처를 Supabase `pdfs` 버킷 → Storige 인쇄 백엔드로 일원화.
--
--   orders 에 Storige 파일 식별자 + 인쇄 검증 캐시 컬럼 추가.
--   - storige_cover_file_id    : 표지 PDF 의 Storige fileId
--   - storige_interior_file_id : 내지 PDF 의 Storige fileId
--   - storige_validation       : 인쇄 검증(CMYK/재단선/해상도) 결과 캐시(jsonb)
--
--   기존 cover_pdf_key / interior_pdf_key (Supabase storage path) 는 전환 기간
--   동안 병행 유지한다. 다운로드 프록시는 storige_*_file_id 가 있으면 Storige,
--   없으면 레거시 키로 fallback 한다. 보존정책 cron 적용 후, 모든 활성 주문이
--   Storige 로 이전되면 별도 마이그레이션에서 레거시 컬럼을 제거한다.
--
--   ⚠️ status enum / 기타 컬럼은 변경하지 않는다.
-- =====================================================================

alter table public.orders
  add column if not exists storige_cover_file_id    text,
  add column if not exists storige_interior_file_id text,
  add column if not exists storige_validation       jsonb;

comment on column public.orders.storige_cover_file_id is
  'Storige 표지 PDF fileId (POST /files/upload/external 의 id). null=레거시/미생성.';
comment on column public.orders.storige_interior_file_id is
  'Storige 내지 PDF fileId. null=레거시/미생성.';
comment on column public.orders.storige_validation is
  'Storige 인쇄 검증 결과 캐시: { cover?, interior?, validatedAt }.';

-- 보존정책 cron 의 조회 효율 — 배송 완료 + 잔존 Storige 파일 스캔용 부분 인덱스.
create index if not exists orders_storige_retention_idx
  on public.orders (delivered_at)
  where status = 'delivered'
    and (storige_cover_file_id is not null or storige_interior_file_id is not null);
