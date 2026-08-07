-- =====================================================================
-- 0030_funnel_book_completed_once.sql — book_completed 퍼널 이벤트 멱등화
--
-- 배경: `POST /api/cover` 는 표지를 저장할 때마다 book_completed 를 기록한다
--       (app/api/cover/route.ts). 사용자가 표지를 10번 손보면 10건이 쌓여
--       "책 완성" 단계의 분자가 부풀고, 가입→완성 전환율이 과대 계상된다.
--
-- 해법: signup_completed 와 같은 관례 — 앱에서 check-then-insert 하지 않고
--       DB 부분 유니크 인덱스로 원자적 멱등화한다. 중복 INSERT 는 23505 를
--       내고 lib/analytics/funnel.ts 가 이를 정상 흐름으로 무시한다.
--
-- 키를 (project_id, event) 로 잡는 이유: "책 완성"은 프로젝트 단위 사건이다.
--   한 사용자가 책을 두 권 만들면 2건이 기록되어야 한다(user_id 기준이면 못 셈).
--   project_id 가 NULL 인 행은 Postgres 유니크 규칙상 서로 충돌하지 않으므로,
--   projectId 없이 기록되는 경로가 생기더라도 이 인덱스가 막지 않는다
--   (현재 book_completed 발화 지점은 projectId 를 항상 넘긴다).
--
-- ⚠️ 기존 중복이 남아 있으면 CREATE UNIQUE INDEX 가 실패하므로 먼저 정리한다.
--    "최초 완성 시각"이 퍼널에서 의미 있는 값이라 가장 이른 1건만 남긴다.
--    적용 전 영향 규모 확인용 점검 쿼리:
--      select project_id, count(*) from public.funnel_events
--       where event = 'book_completed' and project_id is not null
--       group by project_id having count(*) > 1 order by 2 desc;
-- =====================================================================

-- 1) 프로젝트별 최초 1건만 남기고 중복 제거 (created_at 동률이면 id 순).
delete from public.funnel_events dup
 using public.funnel_events keep
 where dup.event = 'book_completed'
   and keep.event = 'book_completed'
   and dup.project_id is not null
   and dup.project_id = keep.project_id
   and (dup.created_at, dup.id) > (keep.created_at, keep.id);

-- 2) 이후 중복은 DB 가 원자적으로 차단.
create unique index if not exists uq_funnel_book_completed_once
  on public.funnel_events (project_id, event)
  where event = 'book_completed';
