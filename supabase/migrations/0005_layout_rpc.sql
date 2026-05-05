-- M2 후속: layout 재생성 트랜잭션 RPC
-- delete + insert 를 단일 트랜잭션으로 처리하여 재생성 도중 실패 시
-- 기존 페이지가 사라진 상태로 남는 데이터 손실을 방지한다.

create or replace function public.regenerate_project_pages(
  p_project_id uuid,
  p_layout_mode text,
  p_pages jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- 호출자는 service_role 가정. 소유권은 호출 측 라우트에서 검증.
  update projects
     set layout_mode = p_layout_mode,
         updated_at = now()
   where id = p_project_id;

  delete from pages where project_id = p_project_id;

  if jsonb_typeof(p_pages) = 'array' and jsonb_array_length(p_pages) > 0 then
    insert into pages (project_id, page_no, layout_mode, fabric_json)
    select
      p_project_id,
      (elem->>'page_no')::int,
      coalesce(elem->>'layout_mode', p_layout_mode),
      elem->'fabric_json'
    from jsonb_array_elements(p_pages) as elem;
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.regenerate_project_pages(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.regenerate_project_pages(uuid, text, jsonb) to service_role;
