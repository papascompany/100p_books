import ExportClient from "./ExportClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function OrdersExportPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          송장 Excel
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          기본은 결제완료 + 제작중 + 배송중. CJ대한통운 표준 컬럼으로 출력됩니다.
        </p>
      </header>
      <ExportClient />
    </div>
  );
}
