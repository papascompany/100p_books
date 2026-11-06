import AttendanceClient from "./AttendanceClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminAttendancePage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          출석 현황
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          매일 출석 +100P · 한 달 만근(30일, 30일 미만인 달은 전체 일수) 시 +1,000P. 지난 출석 부족분은
          &lsquo;출석 채우기&rsquo;(사유 필수)로만 소급합니다 — 채운 날은 일일 포인트가 없고, 지난 달이 만근이 되면
          만근 보너스를 바로 지급합니다(이번 달은 다음 달 1일 정산).
        </p>
      </header>
      <AttendanceClient />
    </div>
  );
}
