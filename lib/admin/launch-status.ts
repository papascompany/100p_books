import "server-only";

import { createAdminSupabase } from "@/lib/db/admin";

/**
 * 서비스 런치 체크 — 운영 스위치(env)와 필수 데이터의 현재 상태를 한 곳에서 판정.
 *
 * 값(시크릿)은 절대 노출하지 않고 존재 여부만 본다. 각 항목의 해소 절차는
 * docs/LAUNCH-RUNBOOK.md 의 섹션 번호와 1:1 로 대응한다.
 */

export type LaunchItemStatus = "ok" | "off" | "warn";

export interface LaunchItem {
  key: string;
  label: string;
  status: LaunchItemStatus;
  /** off/warn 일 때 실제로 일어나는 일 (한 줄). */
  impact: string;
  /** LAUNCH-RUNBOOK.md 섹션 번호. */
  runbook: string;
  /** 런치 차단(true) vs 나중에 해도 되는 것(false). */
  blocking: boolean;
}

function present(...keys: string[]): boolean {
  return keys.every((k) => {
    const v = process.env[k];
    return typeof v === "string" && v.trim().length > 0;
  });
}

export async function getLaunchStatus(): Promise<LaunchItem[]> {
  const admin = createAdminSupabase();

  const [fontsRes, sizesRes] = await Promise.all([
    admin
      .from("resources")
      .select("id", { count: "exact", head: true })
      .eq("type", "font")
      .eq("active", true),
    admin
      .from("book_sizes")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
  ]);
  const fontCount = fontsRes.count ?? 0;
  const sizeCount = sizesRes.count ?? 0;

  return [
    {
      key: "toss",
      label: "토스페이먼츠 결제 키",
      status: present("TOSS_SECRET_KEY", "NEXT_PUBLIC_TOSS_CLIENT_KEY")
        ? "ok"
        : "off",
      impact: "결제창 호출·승인 불가 — 주문 진행 불가",
      runbook: "§1",
      blocking: true,
    },
    {
      key: "storige",
      label: "Storige 인쇄 백엔드 키",
      status: present("STORIGE_API_KEY", "STORIGE_WORKER_API_KEY")
        ? "ok"
        : "off",
      impact: "인쇄 PDF 저장·검증 불가 — 발주 진행 불가",
      runbook: "§1",
      blocking: true,
    },
    {
      key: "font",
      label: `인쇄용 한글 폰트 (등록 ${fontCount}종)`,
      status: fontCount > 0 ? "ok" : "off",
      impact: "PDF 한글이 폴백 폰트로 렌더 — 인쇄 품질 불량",
      runbook: "§2",
      blocking: true,
    },
    {
      key: "book_sizes",
      label: `책 사이즈 (활성 ${sizeCount}종)`,
      status: sizeCount > 0 ? "ok" : "off",
      impact: "프로젝트 생성 불가",
      runbook: "§2",
      blocking: true,
    },
    {
      key: "email",
      label: "이메일 발송 (Resend)",
      status: present("RESEND_API_KEY", "EMAIL_FROM") ? "ok" : "off",
      // 큐는 보존된다 — 키를 넣으면 밀린 것까지 자동 발송(lib/email/worker.ts).
      impact: "메일 6종 미발송 — 큐에 쌓여 대기, 키 등록 시 밀린 것까지 자동 발송",
      runbook: "§3",
      blocking: false,
    },
    {
      key: "ratelimit",
      label: "Rate limit (Upstash Redis)",
      status: present("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN")
        ? "ok"
        : "off",
      impact: "가입·업로드·후기·탈퇴 속도 제한이 전면 해제(fail-open)",
      runbook: "§4",
      blocking: false,
    },
    {
      key: "kakao",
      label: "카카오 로그인",
      status: process.env.NEXT_PUBLIC_KAKAO_ENABLED === "1" ? "ok" : "off",
      impact: "로그인 페이지에서 카카오 버튼 숨김(이메일 가입만 노출)",
      runbook: "§5",
      blocking: false,
    },
    {
      key: "cron",
      label: "Cron 보호 (CRON_SECRET)",
      status: present("CRON_SECRET") ? "ok" : "warn",
      impact: "cron 라우트가 Vercel 헤더에만 의존",
      runbook: "§1",
      blocking: false,
    },
  ];
}
