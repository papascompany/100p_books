"use client";

import { CheckCircle2, Coins, Loader2, Minus, Plus, Search, Tag, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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

interface DiscountState {
  inputCode: string;
  /** 마지막으로 검증 성공한 코드 (화면에 표시용 정규화) */
  appliedCode: string | null;
  /** 서버에서 내려온 실제 차감액 (KRW) */
  discountAmount: number;
  /** 검증 중 여부 */
  validating: boolean;
  /** 에러 메시지 (실패 시) */
  error: string | null;
}

interface PointsState {
  /** 보유 잔액 */
  balance: number;
  /** 입력 문자열 */
  inputValue: string;
  /** 실제 사용할 포인트 (100 단위 정수) */
  useAmount: number;
  /** 로딩 중 */
  loading: boolean;
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

  const [discount, setDiscount] = useState<DiscountState>({
    inputCode: "",
    appliedCode: null,
    discountAmount: 0,
    validating: false,
    error: null,
  });
  // 최근 검증 요청 식별용 — 이전 응답을 무시하기 위함
  const validateSeqRef = useRef(0);

  const [points, setPoints] = useState<PointsState>({
    balance: 0,
    inputValue: "",
    useAmount: 0,
    loading: true,
  });

  // 포인트 잔액 로드
  useEffect(() => {
    fetch("/api/points")
      .then((r) => r.json() as Promise<{ ok: boolean; data: { balance: number } }>)
      .then((json) => {
        if (json.ok) {
          setPoints((s) => ({ ...s, balance: json.data.balance, loading: false }));
        } else {
          setPoints((s) => ({ ...s, loading: false }));
        }
      })
      .catch(() => setPoints((s) => ({ ...s, loading: false })));
  }, []);

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

  // 포인트 입력 핸들러
  function handlePointsInput(raw: string) {
    const numStr = raw.replace(/\D/g, "");
    const num = numStr === "" ? 0 : parseInt(numStr, 10);
    // 100단위 내림, 보유 잔액 이하, 소계 이하로 클램프
    const clamped = Math.min(num, points.balance, breakdown.total);
    const floored = Math.floor(clamped / 100) * 100;
    setPoints((s) => ({
      ...s,
      inputValue: floored === 0 ? "" : String(floored),
      useAmount: floored,
    }));
  }

  function useAllPoints() {
    const max = Math.min(points.balance, breakdown.total);
    const floored = Math.floor(max / 100) * 100;
    setPoints((s) => ({
      ...s,
      inputValue: String(floored),
      useAmount: floored,
    }));
  }

  // 할인 코드가 적용된 경우 최종 결제 금액 (서버가 재계산하지만 클라에서 미리 표시)
  const finalAmount = Math.max(0, breakdown.total - discount.discountAmount - points.useAmount);

  async function applyDiscountCode() {
    const code = discount.inputCode.trim();
    if (!code) return;

    const seq = ++validateSeqRef.current;
    setDiscount((s) => ({ ...s, validating: true, error: null }));

    try {
      const res = await fetch("/api/discounts/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, subtotal: breakdown.total }),
      });
      // stale 응답 무시
      if (seq !== validateSeqRef.current) return;

      const json = (await res.json()) as
        | { ok: true; data: { valid: true; code: string; discountAmount: number } }
        | { ok: true; data: { valid: false; message: string } }
        | { ok: false; error?: { message: string } };

      if (!res.ok || !json.ok) {
        const msg =
          "error" in json && json.error?.message
            ? json.error.message
            : "코드 검증에 실패했습니다.";
        setDiscount((s) => ({
          ...s,
          validating: false,
          appliedCode: null,
          discountAmount: 0,
          error: msg,
        }));
        return;
      }

      const data = json.data;
      if (!data.valid) {
        setDiscount((s) => ({
          ...s,
          validating: false,
          appliedCode: null,
          discountAmount: 0,
          error: data.message,
        }));
        return;
      }

      setDiscount((s) => ({
        ...s,
        validating: false,
        appliedCode: data.code,
        discountAmount: data.discountAmount,
        error: null,
      }));
    } catch (e) {
      if (seq !== validateSeqRef.current) return;
      setDiscount((s) => ({
        ...s,
        validating: false,
        appliedCode: null,
        discountAmount: 0,
        error: e instanceof Error ? e.message : "네트워크 오류가 발생했습니다.",
      }));
    }
  }

  function removeDiscountCode() {
    setDiscount({
      inputCode: "",
      appliedCode: null,
      discountAmount: 0,
      validating: false,
      error: null,
    });
  }

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
          ...(discount.appliedCode ? { discountCode: discount.appliedCode } : {}),
          ...(points.useAmount > 0 ? { pointsToUse: points.useAmount } : {}),
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
        amount: json.data.amount, // 서버가 재계산한 최종 금액
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

        {/* 할인 코드 */}
        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Tag className="h-4 w-4 text-muted-foreground" aria-hidden />
            할인 코드
          </h2>

          {discount.appliedCode ? (
            /* 적용 완료 상태 */
            <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-800 dark:bg-emerald-950/40">
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                />
                <p className="text-sm text-emerald-700 dark:text-emerald-300">
                  <span className="font-semibold">{discount.appliedCode}</span> 코드:{" "}
                  <span className="font-semibold text-rose-600 dark:text-rose-400">
                    -{fmtKrw(discount.discountAmount)}
                  </span>{" "}
                  할인 적용됨
                </p>
              </div>
              <button
                type="button"
                onClick={removeDiscountCode}
                aria-label="할인 코드 제거"
                className="ml-2 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <XCircle className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : (
            /* 입력 상태 */
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <Input
                  value={discount.inputCode}
                  onChange={(e) =>
                    setDiscount((s) => ({
                      ...s,
                      inputCode: e.target.value.toUpperCase(),
                      error: null,
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void applyDiscountCode();
                  }}
                  placeholder="할인 코드 입력"
                  aria-label="할인 코드"
                  aria-describedby={discount.error ? "discount-error" : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 font-mono tracking-wider uppercase"
                  disabled={discount.validating}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void applyDiscountCode()}
                  disabled={discount.validating || discount.inputCode.trim().length === 0}
                  aria-label="할인 코드 적용"
                  className="shrink-0"
                >
                  {discount.validating ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : null}
                  {discount.validating ? "확인 중…" : "적용"}
                </Button>
              </div>
              {discount.error ? (
                <p
                  id="discount-error"
                  role="alert"
                  className="flex items-center gap-1.5 text-xs text-destructive"
                >
                  <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {discount.error}
                </p>
              ) : null}
            </div>
          )}
        </section>

        {/* 포인트 사용 */}
        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Coins className="h-4 w-4 text-amber-500" aria-hidden />
            포인트 사용
          </h2>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                보유 포인트:{" "}
                {points.loading ? (
                  <span className="animate-pulse">로딩 중...</span>
                ) : (
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    {KRW.format(points.balance)}P
                  </span>
                )}
              </span>
              <span>100P 단위로 사용 가능</span>
            </div>
            <div className="flex gap-2">
              <Input
                value={points.inputValue}
                onChange={(e) => handlePointsInput(e.target.value)}
                inputMode="numeric"
                placeholder="사용할 포인트 입력 (100 단위)"
                aria-label="사용할 포인트"
                disabled={points.loading || points.balance === 0}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="default"
                onClick={useAllPoints}
                disabled={points.loading || points.balance === 0}
                aria-label="포인트 전액 사용"
                className="shrink-0"
              >
                전액 사용
              </Button>
            </div>
            {points.useAmount > 0 ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {KRW.format(points.useAmount)}P 차감 예정
              </p>
            ) : points.balance === 0 && !points.loading ? (
              <p className="text-xs text-muted-foreground">
                사용 가능한 포인트가 없습니다.{" "}
                <a href="/mypage" className="underline hover:text-foreground">
                  친구 추천
                </a>
                으로 포인트를 적립하세요.
              </p>
            ) : null}
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
            <Row label="소계" value={fmtKrw(breakdown.total)} />
            {discount.discountAmount > 0 ? (
              <Row
                label={`할인 코드 (${discount.appliedCode ?? ""})`}
                value={`-${fmtKrw(discount.discountAmount)}`}
                accent="coupon"
              />
            ) : null}
            {points.useAmount > 0 ? (
              <Row
                label="포인트 차감"
                value={`-${fmtKrw(points.useAmount)}`}
                accent="coupon"
              />
            ) : null}
            <hr className="my-2 border-border" />
            <div className="flex items-baseline justify-between">
              <dt className="text-sm font-medium">최종 결제 금액</dt>
              <dd className="font-display text-2xl font-semibold tracking-tight">
                {fmtKrw(finalAmount)}
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
          {submitting ? "처리 중…" : `${fmtKrw(finalAmount)} 결제하기`}
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
  accent?: "discount" | "coupon";
}) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd
        className={
          props.accent === "discount" || props.accent === "coupon"
            ? "font-medium text-rose-600 dark:text-rose-400"
            : "text-foreground"
        }
      >
        {props.value}
      </dd>
    </div>
  );
}
