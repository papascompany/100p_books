-- =====================================================================
-- 0028_concurrency_unique_indexes.sql
--   전수감사 후속 — 앱 레벨 check-then-insert 의 TOCTOU 레이스를 DB 부분
--   유니크 인덱스로 원자적 멱등화한다 (Medium #13 gift, #23 출석 보너스).
--
--   ⚠️ 기존 데이터에 중복이 있으면 CREATE UNIQUE INDEX 가 실패한다. 운영 적용 전
--      아래 점검 쿼리로 중복이 없는지 확인할 것(신규 서비스라 보통 0건):
--      -- gift 활성 중복:
--      --   select order_id, count(*) from public.gifts
--      --    where status in ('pending','claimed') group by order_id having count(*)>1;
--      -- 보너스 중복:
--      --   select user_id, memo, count(*) from public.point_ledger
--      --    where reason='attendance_bonus' group by user_id, memo having count(*)>1;
-- =====================================================================

-- #13 — 한 주문당 활성(pending|claimed) gift 1건만 허용.
--   expired 는 제외하므로 만료 후 재발급은 정상 동작.
create unique index if not exists gifts_active_order_uniq
  on public.gifts (order_id)
  where status in ('pending', 'claimed');

-- #23 — 월 출석 보너스는 사용자·월(memo)당 1회만.
--   memo 는 add_user_points_v2 가 기록하는 '${monthKey} 10일 달성 보너스' 상수라
--   (user_id, memo) 가 user×month 멱등 키. 동시 INSERT 중 하나만 성공(나머지 23505),
--   RPC 가 트랜잭션 내라 실패분은 잔액 증가까지 함께 롤백되어 원자적 멱등.
create unique index if not exists point_ledger_bonus_uniq
  on public.point_ledger (user_id, memo)
  where reason = 'attendance_bonus';
