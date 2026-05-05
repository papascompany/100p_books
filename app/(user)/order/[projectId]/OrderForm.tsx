"use client";

import { Loader2, Minus, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { usePostcode } from "@/lib/address/use-postcode";
import { calcOrderAmount, type CalcOrderAmountResult } from "@/lib/orders/pricing";

export interface OrderFormProps {
  projectId: string;
  projectTitle: string;
  bookSizeName: string;
  pageCount: number;
  userEmail: string | null;
}

interface AddressState {
  name: string;
  phone: string;
  zip: string;
  addr1: string;
  addr2: string;
  memo: string;
}

const KRW = new Intl.NumberFormat("ko-KR");

/** 한국 휴대전화 — 010-1234-5678 등. */
const PHONE_REGEX = /^(\+?82-?|0)1[016789]-?\d{3,4}-?\d{4}$/;
const ZIP_REGEX = /^\d{5}$/;

export default function OrderForm(props: OrderFormProps) {
  const { toast } = useToast();
  const postcode = usePostcode();
  const [qty, setQty] = useState(1);
  const [address, setAddress] = useState<AddressState>({
    name: "",
    phone: "",
    zip: "",
    addr1: "",
    addr2: "",
    memo: "",
  });
  const [agreeService, setAgreeService] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeRefund, setAgreeRefund] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPostcode = async () => {
    try {
      await postcode.open((data) => {
        setAddress((s) => ({
          ...s,
          zip: data.zonecode,
          addr1: data.address,
        }));
        // 상세주소 입력으로 포커스 이동
        const el = document.getElementById("addr2-input");
        if (el instanceof HTMLInputElement) el.focus();
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "우편번호 SDK 로드 실패",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const breakdown = useMemo<CalcOrderAmountResult>(
    () =>
      calcOrderAmount({
        bookSize: props.bookSizeName,
        pageCount: props.pageCount,
        qty,
      }),
    [props.bookSizeName, props.pageCount, qty],
  );

  const addressValid =
    address.name.trim().length > 0 &&
    PHONE_REGEX.test(address.phone.trim()) &&
    ZIP_REGEX.test(address.zip.trim()) &&
    address.addr1.trim().length > 0;

  const allAgreed = agreeService && agreePrivacy && agreeRefund;

  const canSubmit = !submitting && addressValid && allAgreed && qty >= 1;

  function update<K extends keyof AddressState>(k: K, v: string) {
    setAddress((s) => ({ ...s, [k]: v }));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      // 1) 주문 생성
      const res = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: props.projectId,
          qty,
          address: {
            name: address.name.trim(),
            phone: address.phone.trim(),
            zip: address.zip.trim(),
            addr1: address.addr1.trim(),
            addr2: address.addr2.trim() || undefined,
            memo: address.memo.trim() || undefined,
          },
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: {
          orderId: string;
          amount: number;
          tossOrderId: string;
          tossOrderName: string;
        };
        error?: { message: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "주문 생성 실패");
      }

      // 2) 토스 결제창 호출
      const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
      if (!clientKey) {
        throw new Error(
          "토스 결제 키가 설정되어 있지 않습니다. (NEXT_PUBLIC_TOSS_CLIENT_KEY)",
        );
      }
      // 동적 import — 번들 사이즈 절감.
      type TossPaymentsInstance = {
        requestPayment: (
          method: string,
          opts: Record<string, unknown>,
        ) => Promise<unknown>;
      };
      type TossSdkModule = {
        loadTossPayments: (key: string) => Promise<TossPaymentsInstance>;
      };
      let mod: TossSdkModule;
      try {
        mod = (await import(
          /* webpackChunkName: "toss-sdk" */ "@tosspayments/payment-sdk"
        )) as unknown as TossSdkModule;
      } catch (e) {
        throw new Error(
          "토스 결제 SDK 로드 실패: " + (e instanceof Error ? e.message : String(e)),
        );
      }
      const tp = await mod.loadTossPayments(clientKey);

      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      // 토스가 successUrl 에 ?paymentKey=&orderId=&amount= 를 append 한다.
      // 우리 내부 orderId 와 충돌하지 않도록 별도 키로 전달.
      const successUrl = `${origin}/order/${props.projectId}/success?ourOrderId=${encodeURIComponent(json.data.orderId)}`;
      const failUrl = `${origin}/order/${props.projectId}/fail?ourOrderId=${encodeURIComponent(json.data.orderId)}`;

      await tp.requestPayment("카드", {
        amount: json.data.amount,
        orderId: json.data.tossOrderId,
        orderName: json.data.tossOrderName,
        successUrl,
        failUrl,
        customerEmail: props.userEmail ?? undefined,
        customerName: address.name.trim() || undefined,
      });
      // 위 호출은 결제창 redirect 로 이어진다 — 정상 흐름에서는 아래 라인이 실행되지 않음.
    } catch (e) {
      setError(e instanceof Error ? e.message : "결제 요청 실패");
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr,360px]">
      {/* 좌측 — 입력 폼 */}
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
            주문서
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {props.projectTitle} · {props.bookSizeName} · {props.pageCount}p
          </p>
        </header>

        {/* 수량 */}
        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold">수량</h2>
          <div className="mt-3 flex items-center gap-3">
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="수량 감소"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
            >
              <Minus />
            </Button>
            <span
              className="min-w-[2.5rem] text-center font-display text-xl font-semibold"
              aria-live="polite"
            >
              {qty}
            </span>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="수량 증가"
              onClick={() => setQty((q) => Math.min(10, q + 1))}
              disabled={qty >= 10}
            >
              <Plus />
            </Button>
            <span className="text-xs text-muted-foreground">
              최대 10권 · 2권 5% 할인 · 5권 10% 할인
            </span>
          </div>
        </section>

        {/* 배송지 */}
        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold">배송지</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="받는 분" required>
              <Input
                value={address.name}
                onChange={(e) => update("name", e.target.value)}
                autoComplete="name"
                required
              />
            </Field>
            <Field label="전화번호" required hint="예: 010-1234-5678">
              <Input
                value={address.phone}
                onChange={(e) => update("phone", e.target.value)}
                autoComplete="tel"
                inputMode="tel"
                required
              />
            </Field>
            <Field label="우편번호" required>
              <div className="flex gap-2">
                <Input
                  value={address.zip}
                  onChange={(e) => update("zip", e.target.value.replace(/\D/g, "").slice(0, 5))}
                  autoComplete="postal-code"
                  inputMode="numeric"
                  required
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  onClick={() => void openPostcode()}
                  disabled={postcode.loading}
                  aria-label="우편번호 검색"
                >
                  {postcode.loading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Search />
                  )}
                  검색
                </Button>
              </div>
            </Field>
            <Field label="주소" required className="sm:col-span-2">
              <Input
                value={address.addr1}
                onChange={(e) => update("addr1", e.target.value)}
                autoComplete="address-line1"
                required
              />
            </Field>
            <Field label="상세주소" className="sm:col-span-2">
              <Input
                id="addr2-input"
                value={address.addr2}
                onChange={(e) => update("addr2", e.target.value)}
                autoComplete="address-line2"
              />
            </Field>
            <Field label="배송 메모" className="sm:col-span-2">
              <Input
                value={address.memo}
                onChange={(e) => update("memo", e.target.value)}
                placeholder="예: 부재 시 경비실에 맡겨주세요"
              />
            </Field>
          </div>
        </section>

        {/* 약관 */}
        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold">약관 동의</h2>
          <div className="mt-3 space-y-2 text-sm">
            <Agree
              checked={agreeService}
              onChange={setAgreeService}
              label="서비스 이용약관 동의"
            />
            <Agree
              checked={agreePrivacy}
              onChange={setAgreePrivacy}
              label="개인정보 수집·이용 동의"
            />
            <Agree
              checked={agreeRefund}
              onChange={setAgreeRefund}
              label="교환·환불 정책 동의 (사용자 제작 인쇄물 특성상 단순 변심 환불 불가)"
            />
          </div>
        </section>
      </div>

      {/* 우측 — 가격 요약 + CTA */}
      <aside className="space-y-3 md:sticky md:top-24 md:self-start">
        <div className="rounded-2xl border bg-card p-4 sm:p-5">
          <h2 className="font-display text-lg font-semibold">결제 요약</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label={`기본 단가 (${props.bookSizeName})`} value={fmtKrw(breakdown.unit)} />
            {breakdown.surcharge > 0 ? (
              <Row
                label={`페이지 추가 (${props.pageCount}p)`}
                value={`+${fmtKrw(breakdown.surcharge)}`}
              />
            ) : null}
            <Row label="수량" value={`× ${qty}`} />
            {breakdown.discount > 0 ? (
              <Row
                label={`수량 할인 (${Math.round(breakdown.discountRatio * 100)}%)`}
                value={`-${fmtKrw(breakdown.discount)}`}
                accent="discount"
              />
            ) : null}
            <hr className="my-2 border-border" />
            <div className="flex items-baseline justify-between">
              <dt className="text-sm font-medium">최종 결제 금액</dt>
              <dd className="font-display text-2xl font-semibold tracking-tight">
                {fmtKrw(breakdown.total)}
              </dd>
            </div>
          </dl>
        </div>

        <Button
          type="button"
          size="lg"
          variant="gradient"
          className="w-full"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
        >
          {submitting ? <Loader2 className="animate-spin" /> : null}
          {submitting ? "처리 중…" : `${fmtKrw(breakdown.total)} 결제하기`}
        </Button>

        {!addressValid ? (
          <p className="text-xs text-muted-foreground">
            배송지를 모두 입력하면 결제 버튼이 활성화됩니다.
          </p>
        ) : !allAgreed ? (
          <p className="text-xs text-muted-foreground">
            약관에 모두 동의하면 결제 버튼이 활성화됩니다.
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

function fmtKrw(n: number): string {
  return `${KRW.format(n)}원`;
}

function Field(props: {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={"flex flex-col gap-1.5 " + (props.className ?? "")}>
      <span className="text-xs font-medium text-muted-foreground">
        {props.label}
        {props.required ? <span className="text-rose-500"> *</span> : null}
      </span>
      {props.children}
      {props.hint ? (
        <span className="text-xs text-muted-foreground/80">{props.hint}</span>
      ) : null}
    </label>
  );
}

function Agree(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input accent-rose-500"
      />
      <span>{props.label}</span>
    </label>
  );
}

function Row(props: {
  label: string;
  value: string;
  accent?: "discount";
}) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd
        className={
          props.accent === "discount" ? "text-rose-600" : "text-foreground"
        }
      >
        {props.value}
      </dd>
    </div>
  );
}
