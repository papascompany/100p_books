-- =====================================================================
-- 0003_seed.sql — 기본 book_sizes 시드
-- cover_width_mm  = (width * 2 + spine) + 6mm 여유 (spine 은 주문 시점 계산 → 베이스는 spine=0)
-- cover_height_mm = height + 4mm 여유
-- spine_formula_per_page = 0.09 (페이지당 mm)
-- =====================================================================

insert into public.book_sizes
  (name, width_mm, height_mm, cover_width_mm, cover_height_mm, spine_formula_per_page, active, display_order)
values
  -- A5 (148 × 210)
  ('A5',         148, 210, 302, 214, 0.09, true, 10),
  -- 정사각 14.5 × 14.5
  ('14.5×14.5',  145, 145, 296, 149, 0.09, true, 20),
  -- 정사각 20 × 20
  ('20×20',      200, 200, 406, 204, 0.09, true, 30)
on conflict do nothing;
