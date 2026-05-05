-- =====================================================================
-- 0008_orders_tracking.sql — orders 배송 추적 컬럼 + 관리자 정렬 인덱스
--
-- 추가:
--   tracking_no       — 송장 번호 (CJ대한통운 등)
--   tracking_carrier  — 배송사 식별자 (예: 'cj', 'hanjin', ...)
--   shipped_at        — 발송 시각 (paid → shipped 전이 시 set)
--   delivered_at      — 배송 완료 시각 (shipped → delivered 전이 시 set)
--
-- 인덱스:
--   idx_orders_status_paid_at — 관리자 리스트 (status 필터 + 결제일 정렬) 용
-- =====================================================================

alter table public.orders
  add column if not exists tracking_no       text,
  add column if not exists tracking_carrier  text,
  add column if not exists shipped_at        timestamptz,
  add column if not exists delivered_at      timestamptz;

-- 관리자 리스트는 (status, paid_at desc) 로 가장 자주 조회됨.
-- (paid_at 이 nullable 이지만 NULLS LAST 가 기본 동작이라 그대로 둔다.)
create index if not exists idx_orders_status_paid_at
  on public.orders (status, paid_at desc);
