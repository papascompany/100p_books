import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import OrderPdfButtons from "./OrderPdfButtons";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/db/admin";
import { createServerSupabase } from "@/lib/db/server";
import type { OrderAddress, OrderStatus } from "@/lib/db/types";
import {
  canDownloadPdfs,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
} from "@/lib/orders/state";
import { PDFS_BUCKET, PDF_SIGNED_TTL_SEC } from "@/lib/pdf/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KRW = new Intl.NumberFormat("ko-KR");
const DT = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

interface PageProps {
  params: { orderId: string };
}

interface OrderDetailRow {
  id: string;
  project_id: string;
  qty: number;
  amount: number;
  address: OrderAddress;
  status: OrderStatus;
  toss_payment_key: string | null;
  toss_order_id: string | null;
  cover_pdf_key: string | null;
  interior_pdf_key: string | null;
  paid_at: string | null;
  created_at: string;
  projects: {
    id: string;
    title: string | null;
    book_sizes: { name: string } | null;
  } | null;
}

export default async function OrderDetailPage({ params }: PageProps) {
  try {
    await requireUser();
  } catch {
    redirect(`/login?next=/mypage/orders/${params.orderId}`);
  }

  const supabase = createServerSupabase();
  const { data: row, error } = await supabase
    .from("orders")
    .select(
      "id, project_id, qty, amount, address, status, toss_payment_key, toss_order_id, cover_pdf_key, interior_pdf_key, paid_at, created_at, projects(id, title, book_sizes(name))",
    )
    .eq("id", params.orderId)
    .maybeSingle();
  if (error) {
    return (
      <div className="container py-10">
        <p className="text-sm text-destructive">
          주문을 불러오지 못했습니다: {error.message}
        </p>
      </div>
    );
  }
  if (!row) notFound();
  const order = row as unknown as OrderDetailRow;
  // RLS 가 user_id 기준 SELECT 를 보호하므로 추가 소유권 체크는 생략.

  // PDF signedUrl 발급 (paid 이상일 때만)
  let coverUrl: string | null = null;
  let interiorUrl: string | null = null;
  if (canDownloadPdfs(order.status)) {
    const admin = createAdminSupabase();
    if (order.cover_pdf_key) {
      const { data: signed } = await admin.storage
        .from(PDFS_BUCKET)
        .createSignedUrl(order.cover_pdf_key, PDF_SIGNED_TTL_SEC, {
          download: `${order.projects?.title ?? "book"}-cover.pdf`,
        });
      coverUrl = signed?.signedUrl ?? null;
    }
    if (order.interior_pdf_key) {
      const { data: signed } = await admin.storage
        .from(PDFS_BUCKET)
        .createSignedUrl(order.interior_pdf_key, PDF_SIGNED_TTL_SEC, {
          download: `${order.projects?.title ?? "book"}-interior.pdf`,
        });
      interiorUrl = signed?.signedUrl ?? null;
    }
  }

  return (
    <div className="container py-6 md:py-10">
      <nav className="mb-3 text-xs text-muted-foreground">
        <Link href="/mypage/orders" className="hover:text-foreground">
          ← 주문 내역
        </Link>
      </nav>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
            {order.projects?.title ?? "Untitled"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            주문번호 {order.id}
          </p>
        </div>
        <span
          className={
            "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium " +
            ORDER_STATUS_BADGE[order.status]
          }
        >
          {ORDER_STATUS_LABEL[order.status]}
        </span>
      </header>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {/* 주문 요약 */}
        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold">주문 요약</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="책 사이즈" value={order.projects?.book_sizes?.name ?? "—"} />
            <Row label="수량" value={`${order.qty}권`} />
            <Row label="결제 금액" value={`${KRW.format(order.amount)}원`} />
            <Row label="주문 일시" value={DT.format(new Date(order.created_at))} />
            {order.paid_at ? (
              <Row label="결제 일시" value={DT.format(new Date(order.paid_at))} />
            ) : null}
            {order.toss_payment_key ? (
              <Row label="결제 키" value={order.toss_payment_key.slice(0, 12) + "…"} />
            ) : null}
          </dl>
        </section>

        {/* 배송지 */}
        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold">배송지</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="받는 분" value={order.address.name} />
            <Row label="연락처" value={order.address.phone} />
            <Row
              label="주소"
              value={
                `(${order.address.zip}) ${order.address.addr1}` +
                (order.address.addr2 ? ` ${order.address.addr2}` : "")
              }
            />
            {order.address.memo ? (
              <Row label="배송 메모" value={order.address.memo} />
            ) : null}
          </dl>
        </section>
      </div>

      {/* PDF 다운로드 */}
      <section className="mt-6 rounded-2xl border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold">PDF 파일</h2>
        {!canDownloadPdfs(order.status) ? (
          <p className="mt-2 text-sm text-muted-foreground">
            결제 완료 후 PDF 파일을 다운로드할 수 있습니다.
          </p>
        ) : (
          <OrderPdfButtons
            initialCoverUrl={coverUrl}
            initialInteriorUrl={interiorUrl}
          />
        )}
      </section>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href={`/editor/${order.project_id}`}>프로젝트 보기</Link>
        </Button>
      </div>
    </div>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="text-right text-foreground">{props.value}</dd>
    </div>
  );
}
