import EmailsClient from "./EmailsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminEmailsPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          이메일 잡
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          결제·상태 전이·가입·탈퇴 시점에 큐에 등록된 알림 메일.
          SMTP 미설정 환경에서는 status=&apos;cancelled&apos; 로 마킹되며, Phase 12 에서 Resend
          등 통합 후 자동 발송돼요.
        </p>
      </header>
      <EmailsClient />
    </div>
  );
}
