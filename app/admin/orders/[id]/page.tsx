import Link from "next/link";
import { notFound } from "next/navigation";

import StatusBadge from "@/components/admin/StatusBadge";
import { Button } from "@/components/ui/button";
import { createAdminSupabase } from "@/lib/db/admin";
import type {
  OrderAddress,
  OrderStatus,
  StorigeValidationCache,
  StorigeValidationResult,
} from "@/lib/db/types";

import OrderActions from "./OrderActions";

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

interface OrderRow {
  id: string;
  project_id: string;
  user_id: string;
  qty: number;
  amount: number;
  address: OrderAddress;
  status: OrderStatus;
  toss_payment_key: string | null;
  toss_order_id: string | null;
  cover_pdf_key: string | null;
  interior_pdf_key: string | null;
  storige_cover_file_id: string | null;
  storige_interior_file_id: string | null;
  storige_validation: StorigeValidationCache | null;
  paid_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  tracking_no: string | null;
  tracking_carrier: string | null;
  created_at: string;
  updated_at: string;
  projects: {
    id: string;
    title: string | null;
    book_sizes: { id: string; name: string; width_mm: number; height_mm: number } | null;
  } | null;
  profiles: { id: string; email: string | null; display_name: string | null } | null;
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("orders")
    .select(
      "id, project_id, user_id, qty, amount, address, status, toss_payment_key, toss_order_id, cover_pdf_key, interior_pdf_key, storige_cover_file_id, storige_interior_file_id, storige_validation, paid_at, shipped_at, delivered_at, tracking_no, tracking_carrier, created_at, updated_at, projects(id, title, book_sizes(id, name, width_mm, height_mm)), profiles(id, email, display_name)",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (error) {
    return <p className="text-sm text-destructive">불러오기 실패: {error.message}</p>;
  }
  if (!data) notFound();
  const o = data as unknown as OrderRow;

  // 가장 최근 PDF 빌드 잡 — 실패 잡이 있으면 재시도 버튼 노출
  const { data: latestJob } = await (
    admin as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (
            k: string,
            v: string,
          ) => {
            order: (
              c: string,
              o: { ascending: boolean },
            ) => {
              limit: (
                n: number,
              ) => {
                maybeSingle: () => Promise<{
                  data: {
                    id: string;
                    status: string;
                    attempt: number;
                    max_attempts: number;
                    last_error: string | null;
                  } | null;
                }>;
              };
            };
          };
        };
      };
    }
  )
    .from("pdf_build_jobs")
    .select("id, status, attempt, max_attempts, last_error")
    .eq("order_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // PDF 다운로드 — 서버 프록시 경유 (admin 은 상태 무관 다운로드 가능).
  const coverUrl =
    o.storige_cover_file_id || o.cover_pdf_key
      ? `/api/orders/${o.id}/download/cover`
      : null;
  const interiorUrl =
    o.storige_interior_file_id || o.interior_pdf_key
      ? `/api/orders/${o.id}/download/interior`
      : null;

  return (
    <div className="space-y-5">
      <nav className="text-xs text-muted-foreground">
        <Link href="/admin/orders" className="hover:text-foreground">
          ← 주문 목록
        </Link>
      </nav>

      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
            {o.projects?.title ?? "Untitled"}
          </h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {o.id}
          </p>
        </div>
        <StatusBadge status={o.status} />
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="주문 요약">
          <Row label="책 사이즈" value={o.projects?.book_sizes?.name ?? "—"} />
          <Row label="판형 (mm)" value={
            o.projects?.book_sizes
              ? `${o.projects.book_sizes.width_mm} × ${o.projects.book_sizes.height_mm}`
              : "—"
          } />
          <Row label="수량" value={`${o.qty}권`} />
          <Row label="금액" value={`${KRW.format(o.amount)}원`} />
          <Row label="주문 일시" value={DT.format(new Date(o.created_at))} />
          {o.paid_at ? (
            <Row label="결제 일시" value={DT.format(new Date(o.paid_at))} />
          ) : null}
          {o.shipped_at ? (
            <Row label="발송 일시" value={DT.format(new Date(o.shipped_at))} />
          ) : null}
          {o.delivered_at ? (
            <Row label="배송 완료" value={DT.format(new Date(o.delivered_at))} />
          ) : null}
        </Section>

        <Section title="사용자 / 결제">
          <Row label="이메일" value={o.profiles?.email ?? "—"} />
          {o.profiles?.display_name ? (
            <Row label="이름" value={o.profiles.display_name} />
          ) : null}
          <Row label="user_id" value={
            <span className="font-mono text-[11px]">{o.user_id}</span>
          } />
          {o.toss_order_id ? (
            <Row label="토스 주문ID" value={
              <span className="font-mono text-[11px]">{o.toss_order_id}</span>
            } />
          ) : null}
          {o.toss_payment_key ? (
            <Row label="결제 키" value={
              <span className="font-mono text-[11px]">{o.toss_payment_key.slice(0, 16)}…</span>
            } />
          ) : null}
        </Section>

        <Section title="배송지">
          <Row label="받는 분" value={o.address.name} />
          <Row label="연락처" value={o.address.phone} />
          <Row
            label="주소"
            value={
              `(${o.address.zip}) ${o.address.addr1}` +
              (o.address.addr2 ? ` ${o.address.addr2}` : "")
            }
          />
          {o.address.memo ? <Row label="메모" value={o.address.memo} /> : null}
          {o.tracking_no ? (
            <Row
              label="송장"
              value={`${o.tracking_carrier ?? ""} ${o.tracking_no}`}
            />
          ) : null}
        </Section>

        <Section title="PDF">
          <div className="flex flex-wrap gap-2">
            {coverUrl ? (
              <Button asChild variant="outline" size="sm">
                <a href={coverUrl}>표지 PDF</a>
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">표지: 미생성</span>
            )}
            {interiorUrl ? (
              <Button asChild variant="outline" size="sm">
                <a href={interiorUrl}>내지 PDF</a>
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">내지: 미생성</span>
            )}
          </div>
        </Section>

        {o.storige_validation ? (
          <Section title="인쇄 검증 (Storige)">
            <ValidationRow label="표지" v={o.storige_validation.cover} />
            <ValidationRow label="내지" v={o.storige_validation.interior} />
            {o.storige_validation.validatedAt ? (
              <Row
                label="검증 일시"
                value={DT.format(new Date(o.storige_validation.validatedAt))}
              />
            ) : null}
            <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
              규격·재단·색상·해상도 자동 검증 결과입니다. COMPLETED=통과(경고는
              정보성), FIXABLE=자동수정 가능한 규격 에러(페이지 배수 등),
              FAILED=수정불가 에러. 현재 주문/발주를 자동 차단하지 않으므로
              FIXABLE/FAILED 는 발주 전 확인이 필요합니다.
            </p>
          </Section>
        ) : null}
      </div>

      <Section title="액션">
        <OrderActions
          orderId={o.id}
          status={o.status}
          trackingNo={o.tracking_no}
          trackingCarrier={o.tracking_carrier}
          pdfJob={
            latestJob
              ? {
                  id: latestJob.id,
                  status: latestJob.status,
                  attempt: latestJob.attempt,
                  maxAttempts: latestJob.max_attempts,
                  lastError: latestJob.last_error,
                }
              : null
          }
        />
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3 space-y-2 text-sm">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

/** unknown 배열 요소(ValidationError/Warning)에서 표시용 문자열을 안전 추출. */
function messageOf(x: unknown): string {
  if (typeof x === "string") return x;
  if (x && typeof x === "object") {
    const rec = x as Record<string, unknown>;
    if (typeof rec.message === "string") return rec.message;
    if (typeof rec.code === "string") return rec.code;
  }
  return JSON.stringify(x);
}

/** 검증 status → 색상 톤. */
function toneOf(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "text-emerald-600";
    case "FIXABLE":
      return "text-amber-600";
    case "FAILED":
    case "ERROR":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function ValidationRow({
  label,
  v,
}: {
  label: string;
  v?: StorigeValidationResult;
}) {
  if (!v) {
    return (
      <Row label={label} value={<span className="text-muted-foreground">미검증</span>} />
    );
  }
  const status = (v.status ?? "").toUpperCase();
  const errors = Array.isArray(v.errors) ? v.errors : [];
  const warnings = Array.isArray(v.warnings) ? v.warnings : [];
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="flex flex-wrap items-baseline justify-end gap-2 text-right">
          <span className={`font-medium ${toneOf(status)}`}>{status || "—"}</span>
          {errors.length > 0 ? (
            <span className="text-destructive">오류 {errors.length}</span>
          ) : null}
          {warnings.length > 0 ? (
            <span className="text-amber-600">경고 {warnings.length}</span>
          ) : null}
        </dd>
      </div>
      {errors.length > 0 ? (
        <ul className="ml-1 list-disc space-y-0.5 pl-4 text-[11px] text-destructive/90">
          {errors.slice(0, 5).map((e, i) => (
            <li key={i}>{messageOf(e)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
