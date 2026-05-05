-- M12: 페이지 reorder / shift RPC
--
-- 1) reorder_project_pages — 임의 순서로 페이지 재정렬.
--    pages.unique(project_id, page_no) 제약을 회피하기 위해 2단계 업데이트:
--      a) 모든 페이지의 page_no 를 -page_no - 1000 으로 임시 이동 (음수 영역).
--      b) 새 순서대로 1..N 재할당.
--
-- 2) shift_pages_after — 특정 page_no 보다 큰 페이지들의 번호를 ±N 만큼 이동.
--    삽입(+1) / 삭제(-1) 시 후속 페이지 번호 압축에 사용.
--
-- 호출은 service_role 만 가능. 라우트에서 소유권 / 입력 검증을 마친 뒤 호출한다.

create or replace function public.reorder_project_pages(
  p_project_id uuid,
  p_page_ids uuid[]
) returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_count int := array_length(p_page_ids, 1);
  v_existing int;
begin
  if v_count is null or v_count = 0 then
    return 0;
  end if;

  -- 모든 page_id 가 해당 project 에 속하고, 길이가 실제 페이지 수와 동일한지 확인.
  select count(*) into v_existing
    from pages
   where project_id = p_project_id;
  if v_existing <> v_count then
    raise exception 'page count mismatch: project=% expected=% got=%',
      p_project_id, v_existing, v_count;
  end if;

  -- 1단계: unique 제약 회피용 임시 이동.
  update pages
     set page_no = -page_no - 1000
   where project_id = p_project_id;

  -- 2단계: 새 순서대로 1..N 재할당. 누락 ID 는 raise.
  for i in 1 .. v_count loop
    update pages
       set page_no = i,
           updated_at = now()
     where project_id = p_project_id
       and id = p_page_ids[i];
    if not found then
      raise exception 'page_id % not found in project %', p_page_ids[i], p_project_id;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.reorder_project_pages(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_project_pages(uuid, uuid[]) to service_role;


create or replace function public.shift_pages_after(
  p_project_id uuid,
  p_after_page_no int,
  p_shift int default 1
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_shift = 0 then
    return;
  end if;

  if p_shift > 0 then
    -- +N: 큰 번호부터 아래로 이동 (unique 제약 회피).
    update pages
       set page_no = page_no + p_shift,
           updated_at = now()
     where project_id = p_project_id
       and page_no > p_after_page_no;
  else
    -- -N: 작은 번호부터 위로 당김.
    update pages
       set page_no = page_no + p_shift,
           updated_at = now()
     where project_id = p_project_id
       and page_no > p_after_page_no;
  end if;
end;
$$;

revoke all on function public.shift_pages_after(uuid, int, int) from public, anon, authenticated;
grant execute on function public.shift_pages_after(uuid, int, int) to service_role;
