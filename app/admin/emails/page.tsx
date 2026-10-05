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
          RESEND_API_KEY 가 없으면 잡은 대기(pending) 상태로 보존되고, 키를 등록하면 5분 cron 이
          밀린 잡까지 순서대로 발송해요. 실패 잡은 5분→30분→2시간 백오프로 재시도돼요.
        </p>
      </header>
      <EmailsClient />
    </div>
  );
}
