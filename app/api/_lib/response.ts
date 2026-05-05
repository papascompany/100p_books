import { NextResponse } from "next/server";

/**
 * 표준 API 응답 포맷: { ok, data?, error? }
 */
export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiFail {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiOk<T> | ApiFail;

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiOk<T>> {
  return NextResponse.json<ApiOk<T>>({ ok: true, data }, init);
}

export function fail(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
): NextResponse<ApiFail> {
  return NextResponse.json<ApiFail>(
    { ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}

/**
 * try/catch 에서 throw 된 에러를 표준 fail 응답으로 변환.
 * err.status 가 있으면 해당 HTTP 코드를 사용.
 */
export function failFromError(err: unknown): NextResponse<ApiFail> {
  if (err && typeof err === "object" && "status" in err && "message" in err) {
    const e = err as { status?: number; message?: string; code?: string };
    return fail(
      e.code ?? "ERROR",
      e.message ?? "알 수 없는 오류가 발생했습니다.",
      e.status ?? 500,
    );
  }
  return fail("INTERNAL", "서버 오류가 발생했습니다.", 500);
}
