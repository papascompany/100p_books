import DiscountsClient from "./DiscountsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminDiscountsPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          할인 코드
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          코드 생성·활성화·만료 관리. 사용 이력이 있는 코드는 강제 삭제가 필요합니다.
        </p>
      </header>
      <DiscountsClient />
    </div>
  );
}
