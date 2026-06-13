/**
 * 일회성 마이그레이션 — 기존 Supabase `pdfs` 버킷의 주문 PDF 를 Storige 로 이전.
 *
 *   NODE_OPTIONS="--require ./scripts/_server-only-stub.cjs" \
 *     npx tsx scripts/migrate-pdfs-to-storige.ts [--commit] [--delete] [--limit=N]
 *
 * 환경변수 필요(tsx 는 .env 자동 로드 안 함 — 미리 export):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STORIGE_API_KEY
 *   (예: `set -a; source .env.local; set +a` 후 실행)
 *
 * 동작:
 *   - cover_pdf_key / interior_pdf_key 가 있고 storige_*_file_id 가 비어있는 주문을 대상.
 *   - 각 PDF: Supabase 다운로드 → Storige 업로드 → orders.storige_*_file_id 기록.
 *   - 멱등: 이미 storige 로 이전된 주문은 건너뜀.
 *
 * 플래그:
 *   (기본)     dry-run — 대상만 출력, 쓰기 없음.
 *   --commit   실제 업로드 + DB 갱신 수행.
 *   --delete   --commit 와 함께 — 이전 성공 후 Supabase 원본 객체 삭제.
 *   --limit=N  처리 주문 수 상한 (기본 1000).
 *
 * ⚠️ 운영 DB 대상. 반드시 dry-run 으로 먼저 확인 후 --commit.
 */
import { createAdminSupabase } from "@/lib/db/admin";
import { PDFS_BUCKET } from "@/lib/pdf/constants";
import { STORIGE_ENABLED, uploadPdf } from "@/lib/storige/client";

interface OrderRow {
  id: string;
  cover_pdf_key: string | null;
  interior_pdf_key: string | null;
  storige_cover_file_id: string | null;
  storige_interior_file_id: string | null;
  projects: { title: string | null } | null;
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq >= 0 ? hit.slice(eq + 1) : "true";
}

async function main() {
  const commit = arg("commit") === "true";
  const del = arg("delete") === "true";
  const limit = Number.parseInt(arg("limit") ?? "1000", 10) || 1000;

  if (!STORIGE_ENABLED) {
    console.error("STORIGE_API_KEY 미설정 — 중단.");
    process.exit(1);
  }
  console.log(
    `[migrate-pdfs] mode=${commit ? "COMMIT" : "DRY-RUN"} delete=${del} limit=${limit}`,
  );

  const admin = createAdminSupabase();

  // 대상: 레거시 키가 있고 아직 storige 로 안 옮긴 주문.
  const { data, error } = await admin
    .from("orders")
    .select(
      "id, cover_pdf_key, interior_pdf_key, storige_cover_file_id, storige_interior_file_id, projects(title)",
    )
    .or("cover_pdf_key.not.is.null,interior_pdf_key.not.is.null")
    .limit(limit);
  if (error) {
    console.error("주문 조회 실패:", error.message);
    process.exit(1);
  }
  const orders = ((data ?? []) as unknown as OrderRow[]).filter(
    (o) =>
      (o.cover_pdf_key && !o.storige_cover_file_id) ||
      (o.interior_pdf_key && !o.storige_interior_file_id),
  );
  console.log(`[migrate-pdfs] 대상 주문: ${orders.length}건`);

  let migrated = 0;
  let failed = 0;
  let deleted = 0;

  for (const o of orders) {
    const title = o.projects?.title ?? "book";
    const jobs: Array<{ kind: "cover" | "interior"; key: string }> = [];
    if (o.cover_pdf_key && !o.storige_cover_file_id) {
      jobs.push({ kind: "cover", key: o.cover_pdf_key });
    }
    if (o.interior_pdf_key && !o.storige_interior_file_id) {
      jobs.push({ kind: "interior", key: o.interior_pdf_key });
    }

    for (const j of jobs) {
      if (!commit) {
        console.log(`  [dry] order=${o.id} ${j.kind} ← ${j.key}`);
        continue;
      }
      try {
        const { data: blob, error: dlErr } = await admin.storage
          .from(PDFS_BUCKET)
          .download(j.key);
        if (dlErr || !blob) throw new Error(`download: ${dlErr?.message ?? "no blob"}`);
        const buf = Buffer.from(await blob.arrayBuffer());

        const up = await uploadPdf(buf, {
          type: j.kind === "cover" ? "cover" : "content",
          filename: `${title}-${j.kind}.pdf`,
        });

        const col =
          j.kind === "cover" ? "storige_cover_file_id" : "storige_interior_file_id";
        const { error: upErr } = await admin
          .from("orders")
          .update({ [col]: up.id })
          .eq("id", o.id);
        if (upErr) throw new Error(`db update: ${upErr.message}`);

        migrated += 1;
        console.log(`  [ok] order=${o.id} ${j.kind} → fileId=${up.id}`);

        if (del) {
          const { error: rmErr } = await admin.storage
            .from(PDFS_BUCKET)
            .remove([j.key]);
          if (rmErr) console.warn(`  [warn] supabase remove 실패: ${rmErr.message}`);
          else deleted += 1;
        }
      } catch (e) {
        failed += 1;
        console.error(
          `  [fail] order=${o.id} ${j.kind}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  console.log(
    `[migrate-pdfs] 완료 — migrated=${migrated} failed=${failed} deleted=${deleted}` +
      (commit ? "" : " (dry-run: 변경 없음)"),
  );
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
