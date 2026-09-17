"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import type { OrderStatus } from "@/lib/db/types";
import { canTransition, ORDER_STATUS_LABEL } from "@/lib/orders/state";
import {
  formatValidationBlocks,
  type ValidationBlock,
} from "@/lib/orders/validation-gate";

const NEXT: Array<{
  to: OrderStatus;
  label: string;
  tone?: "default" | "destructive" | "outline";
}> = [
  { to: "in_production", label: "제작 시작" },
  { to: "shipped", label: "발송 처리 (송장 입력)" },
  { to: "delivered", label: "배송 완료" },
  { to: "cancelled", label: "주문 취소", tone: "destructive" },
  // 토스 결제를 건드리지 않는 상태 기록 전용 — 콘솔에서 이미 전액 취소한 주문 보정용.
  // 실제 결제 취소까지 하는 경로는 아래 '전액 환불' 버튼(/api/admin/orders/:id/refund).
  { to: "refunded", label: "환불 상태만 기록", tone: "outline" },
];

const CARRIER_OPTIONS = [
  { value: "cj", label: "CJ대한통운" },
  { value: "hanjin", label: "한진택배" },
  { value: "lotte", label: "롯데택배" },
  { value: "post", label: "우체국택배" },
  { value: "logen", label: "로젠택배" },
  { value: "etc", label: "기타" },
];

export interface PdfJobBrief {
  id: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  lastError: string | null;
}

export default function OrderActions({
  orderId,
  status,
  trackingNo,
  trackingCarrier,
  pdfJob,
  validationBlocks,
}: {
  orderId: string;
  status: OrderStatus;
  trackingNo: string | null;
  trackingCarrier: string | null;
  pdfJob?: PdfJobBrief | null;
  /** 인쇄 검증(FIXABLE/FAILED) 발주 차단 사유 — 서버 게이트와 동일 판정. */
  validationBlocks?: ValidationBlock[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [tNo, setTNo] = React.useState(trackingNo ?? "");
  const [tCarrier, setTCarrier] = React.useState(trackingCarrier ?? "cj");
  const [showShip, setShowShip] = React.useState(false);
  const [refundOpen, setRefundOpen] = React.useState(false);

  const transition = async (
    to: OrderStatus,
    extras?: { trackingNo?: string; trackingCarrier?: string },
    force = false,
  ) => {
    if (extras && (!extras.trackingNo || !extras.trackingCarrier)) {
      toast({
        variant: "destructive",
        title: "송장 정보 누락",
        description: "송장번호와 배송사를 입력하세요.",
      });
      return;
    }
    // force 재시도는 이미 오버라이드 confirm 을 통과했으므로 기본 confirm 생략.
    if (
      !force &&
      (to === "cancelled" || to === "refunded"
        ? !confirm(
            to === "refunded"
              ? "토스 결제는 취소하지 않고 주문 상태만 '환불됨'으로 기록합니다" +
                  "(사용 포인트·할인 전액 복원).\n\n토스 콘솔에서 이미 전액 취소한 주문에만 " +
                  "사용하세요. 결제 취소까지 하려면 '전액 환불' 버튼을 사용하세요.\n\n" +
                  "계속하시겠습니까?"
              : "주문을 취소하시겠습니까?",
          )
        : !confirm(`상태를 '${to}' 로 변경하시겠습니까?`))
    ) {
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/orders/${orderId}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, ...extras, ...(force ? { force: true } : {}) }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        // 발주 게이트(409) — 검증 미통과. 관리자 확인 후 force 재전송.
        if (r.status === 409 && j?.error?.code === "VALIDATION_BLOCKED") {
          const reason: string =
            j?.error?.message ?? "인쇄 검증(FIXABLE/FAILED) 미통과 상태입니다.";
          if (
            confirm(
              `${reason}\n\n검증 미통과 PDF 로 강제 발주하면 인쇄 사고 책임이 ` +
                "운영자에게 있습니다. 그래도 발주하시겠습니까?",
            )
          ) {
            await transition(to, extras, true);
          }
          return;
        }
        toast({
          variant: "destructive",
          title: "상태 변경 실패",
          description: j?.error?.message ?? "알 수 없는 오류",
        });
        return;
      }
      toast({ variant: "success", title: `상태 변경: ${to}` });
      setShowShip(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const rebuildPdf = async () => {
    if (!confirm("표지/내지 PDF 를 재생성합니다. 계속하시겠습니까?")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/orders/${orderId}/rebuild-pdf`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "all" }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        toast({
          variant: "destructive",
          title: "PDF 재생성 실패",
          description: j?.error?.message ?? "알 수 없는 오류",
        });
        return;
      }
      toast({
        variant: "success",
        title: "PDF 재생성 완료",
        description: "표지/내지 PDF 가 갱신되었습니다.",
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const retryPdfJob = async () => {
    if (!confirm("실패한 PDF 빌드 잡을 재시도합니다. 계속하시겠습니까?")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/orders/${orderId}/retry-pdf`, {
        method: "POST",
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        toast({
          variant: "destructive",
          title: "PDF 재시도 실패",
          description: j?.error?.message ?? "알 수 없는 오류",
        });
        return;
      }
      toast({
        variant: "success",
        title: "PDF 재시도 완료",
        description: "잡 상태를 확인하세요.",
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const showRetry = pdfJob && pdfJob.status === "failed";
  const retryDisabled = pdfJob ? pdfJob.attempt >= pdfJob.maxAttempts : true;

  const showValidationHold =
    !!validationBlocks &&
    validationBlocks.length > 0 &&
    canTransition(status, "in_production");

  return (
    <div className="space-y-3">
      {showValidationHold ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <strong>발주 보류:</strong> 인쇄 검증 미통과 —{" "}
          {formatValidationBlocks(validationBlocks)}. PDF 재생성으로 해소하거나,
          제작 시작 시 확인을 거쳐 강제 발주할 수 있습니다(감사 로그 기록).
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {NEXT.filter((opt) => canTransition(status, opt.to)).map((opt) => {
          if (opt.to === "shipped") {
            return (
              <Button
                key={opt.to}
                variant="default"
                size="sm"
                onClick={() => setShowShip((v) => !v)}
                disabled={busy}
                type="button"
              >
                {opt.label}
              </Button>
            );
          }
          return (
            <Button
              key={opt.to}
              variant={opt.tone ?? "default"}
              size="sm"
              onClick={() => transition(opt.to)}
              disabled={busy}
              type="button"
            >
              {opt.label}
            </Button>
          );
        })}
        {canTransition(status, "refunded") ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setRefundOpen(true)}
            disabled={busy}
            type="button"
          >
            전액 환불
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={rebuildPdf}
          disabled={busy}
          type="button"
        >
          PDF 재생성
        </Button>
        {showRetry ? (
          <Button
            variant="outline"
            size="sm"
            onClick={retryPdfJob}
            disabled={busy || retryDisabled}
            type="button"
            title={
              retryDisabled
                ? `최대 시도(${pdfJob.maxAttempts}) 초과`
                : `시도 ${pdfJob.attempt}/${pdfJob.maxAttempts}`
            }
          >
            PDF 빌드 재시도
            <span className="ml-1 text-[10px] text-muted-foreground">
              ({pdfJob.attempt}/{pdfJob.maxAttempts})
            </span>
          </Button>
        ) : null}
      </div>

      {pdfJob && pdfJob.status === "failed" && pdfJob.lastError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          <strong>마지막 빌드 에러:</strong>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">
            {pdfJob.lastError}
          </pre>
        </div>
      ) : null}

      {showShip ? (
        <div className="rounded-xl border bg-muted/30 p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            발송 처리에는 송장번호와 배송사가 필요합니다.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="block text-[11px] font-medium text-muted-foreground">
                배송사
              </span>
              <select
                value={tCarrier}
                onChange={(e) => setTCarrier(e.target.value)}
                className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {CARRIER_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1 min-w-[200px]">
              <span className="block text-[11px] font-medium text-muted-foreground">
                송장번호
              </span>
              <Input
                value={tNo}
                onChange={(e) => setTNo(e.target.value)}
                className="h-10"
              />
            </label>
            <Button
              size="sm"
              variant="gradient"
              onClick={() =>
                transition("shipped", {
                  trackingNo: tNo.trim(),
                  trackingCarrier: tCarrier,
                })
              }
              disabled={busy || !tNo.trim()}
              type="button"
            >
              확정
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowShip(false)}
              disabled={busy}
              type="button"
            >
              취소
            </Button>
          </div>
        </div>
      ) : null}

      <RefundDialog
        orderId={orderId}
        open={refundOpen}
        onOpenChange={setRefundOpen}
        onDone={() => router.refresh()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 전액 환불 다이얼로그 — GET /refund 미리보기 → POST /refund 실행
// ---------------------------------------------------------------------------

const KRW = new Intl.NumberFormat("ko-KR");

interface RefundPreview {
  order: {
    id: string;
    status: OrderStatus;
    amount: number;
    pointsUsed: number;
    discountAmount: number;
    hasDiscountCode: boolean;
  };
  refundable: boolean;
  requiresForce: boolean;
  block: { code: string; message: string } | null;
  toss: {
    status: string;
    method: string | null;
    totalAmount: number;
    balanceAmount: number | null;
    approvedAt: string | null;
  } | null;
  tossError: string | null;
  tossAlreadyCanceled: boolean;
}

interface RefundResult {
  toss: { method: string | null; totalAmount: number };
  tossOutcome: "canceled" | "already_canceled";
  alreadyRefunded: boolean;
  creditRestoreError: string | null;
}

function RefundDialog({
  orderId,
  open,
  onOpenChange,
  onDone,
}: {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [preview, setPreview] = React.useState<RefundPreview | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [force, setForce] = React.useState(false);
  const [reason, setReason] = React.useState("");

  const loadPreview = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch(`/api/admin/orders/${orderId}/refund`, {
        cache: "no-store",
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setPreview(null);
        setLoadError(j?.error?.message ?? "환불 정보를 불러오지 못했습니다.");
        return;
      }
      setPreview(j.data as RefundPreview);
    } catch {
      setPreview(null);
      setLoadError("환불 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  React.useEffect(() => {
    if (!open) return;
    setForce(false);
    setReason("");
    setPreview(null);
    void loadPreview();
  }, [open, loadPreview]);

  const amount = preview?.toss?.totalAmount ?? preview?.order.amount ?? 0;
  const method = preview?.toss?.method ?? "—";
  const requiresForce = !!preview?.requiresForce;
  const blockedReason = preview?.block?.message ?? null;
  const canSubmit =
    !!preview &&
    preview.refundable &&
    !loading &&
    !submitting &&
    (!requiresForce || (force && reason.trim().length > 0));

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/orders/${orderId}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(requiresForce ? { force: true } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        toast({
          variant: "destructive",
          title: "전액 환불 실패",
          description: j?.error?.message ?? "알 수 없는 오류",
        });
        // 동시 처리·토스 상태 변화로 판정이 바뀌었을 수 있어 미리보기를 갱신한다.
        void loadPreview();
        return;
      }
      const data = j.data as RefundResult;
      toast({
        variant: "success",
        title: "전액 환불 완료",
        description:
          `${KRW.format(data.toss.totalAmount)}원 · ${data.toss.method ?? "결제수단 미상"} — ` +
          (data.alreadyRefunded
            ? "다른 요청(또는 토스 웹훅)이 먼저 주문에 반영했습니다."
            : data.tossOutcome === "already_canceled"
              ? "토스에서 이미 취소된 결제라 주문 상태만 반영했습니다."
              : "토스 결제 취소와 주문 상태 반영을 마쳤습니다."),
      });
      if (data.creditRestoreError) {
        toast({
          variant: "warning",
          title: "포인트·할인 복원 실패",
          description: `결제 취소·환불 상태는 반영됐지만 복원에 실패했습니다(${data.creditRestoreError}). 수동 보정이 필요합니다.`,
        });
      }
      onOpenChange(false);
      onDone();
    } catch {
      toast({
        variant: "destructive",
        title: "전액 환불 결과 확인 실패",
        description:
          "네트워크 오류로 결과를 받지 못했습니다. 새로고침해 주문 상태를 확인한 뒤 필요하면 다시 시도하세요(재시도는 안전합니다).",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 토스 취소 진행 중에는 닫지 않는다(결과 토스트·상태 갱신을 놓치지 않게).
        if (submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>전액 환불</DialogTitle>
          <DialogDescription>
            토스 결제를 <strong>전액 취소</strong>하고 주문을 &lsquo;환불됨&rsquo;으로
            바꿉니다. 사용 포인트·할인 코드도 복원됩니다.{" "}
            <strong className="text-destructive">되돌릴 수 없습니다.</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-3 text-sm">
          {loading ? (
            <p className="text-muted-foreground">결제 정보 확인 중…</p>
          ) : loadError ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-destructive"
            >
              {loadError}
            </p>
          ) : preview ? (
            <>
              <dl className="space-y-1.5 rounded-xl border bg-muted/30 p-3">
                <RefundRow
                  label="환불 금액"
                  value={
                    <span className="text-base font-semibold">
                      {KRW.format(amount)}원
                    </span>
                  }
                />
                <RefundRow label="결제수단" value={method} />
                <RefundRow
                  label="주문 상태"
                  value={ORDER_STATUS_LABEL[preview.order.status] ?? preview.order.status}
                />
                {preview.toss ? (
                  <RefundRow label="토스 결제 상태" value={preview.toss.status} />
                ) : null}
                <RefundRow
                  label="포인트 복원"
                  value={
                    preview.order.pointsUsed > 0
                      ? `${KRW.format(preview.order.pointsUsed)}P`
                      : "없음"
                  }
                />
                <RefundRow
                  label="할인 코드 복원"
                  value={
                    preview.order.hasDiscountCode
                      ? `사용 기록 해제 (${KRW.format(preview.order.discountAmount)}원 할인)`
                      : "없음"
                  }
                />
              </dl>

              {preview.tossAlreadyCanceled ? (
                <p className="rounded-md border border-sky-300 bg-sky-50 p-2 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200">
                  토스에서 이미 취소된 결제입니다. 실행하면 토스 호출 없이 주문 상태와
                  포인트·할인 복원만 반영합니다.
                </p>
              ) : null}

              {preview.tossError ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                  토스 결제 조회 실패: {preview.tossError} — 결제수단·금액은 주문 기록
                  기준이며, 실행 시 서버가 토스를 다시 확인합니다.
                </p>
              ) : null}

              {blockedReason ? (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
                >
                  <strong>환불 불가:</strong> {blockedReason}
                </p>
              ) : null}

              {preview.refundable && requiresForce ? (
                <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                  <p>
                    제작이 시작된 주문입니다. 환불 정책상 인쇄 불량·배송 사고 등 회사
                    귀책일 때만 전액 환불합니다(감사 로그 기록).
                  </p>
                  <label className="flex cursor-pointer items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={force}
                      onChange={(e) => setForce(e.target.checked)}
                      disabled={submitting}
                      className="h-4 w-4 accent-amber-600"
                    />
                    정책 예외 환불임을 확인했습니다
                  </label>
                </div>
              ) : null}

              {preview.refundable ? (
                <label className="block">
                  <span className="block text-[11px] font-medium text-muted-foreground">
                    환불 사유
                    {requiresForce ? " (필수)" : " (선택 — 토스 취소 사유·감사 로그)"}
                  </span>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={200}
                    placeholder={
                      requiresForce ? "예: 인쇄 불량(페이지 결손)" : "고객 요청 전액 환불"
                    }
                    disabled={submitting}
                    className="mt-1 h-10"
                  />
                </label>
              ) : null}
            </>
          ) : null}
        </div>

        <DialogFooter className="mt-5">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            닫기
          </Button>
          <Button
            variant="destructive"
            size="sm"
            type="button"
            onClick={submit}
            disabled={!canSubmit}
          >
            {submitting
              ? "환불 처리 중…"
              : preview?.refundable
                ? `${KRW.format(amount)}원 전액 환불`
                : "전액 환불"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
