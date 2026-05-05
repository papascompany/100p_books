import { notFound } from "next/navigation";

import ResourcesClient from "./ResourcesClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID = new Set(["font", "clipart", "background"]);

const TITLE: Record<string, { ko: string; subtitle: string }> = {
  font: {
    ko: "폰트",
    subtitle:
      "ttf/otf/woff2 (≤5MB). 폰트 family / weight / style / 라이선스 메타 필수.",
  },
  clipart: {
    ko: "클립아트",
    subtitle: "svg/png (≤2MB). 투명 배경 권장.",
  },
  background: {
    ko: "배경",
    subtitle: "jpg/png (≤10MB), 가로 2400px 이상.",
  },
};

export default function ResourceTypePage({
  params,
}: {
  params: { type: string };
}) {
  const type = params.type;
  if (!VALID.has(type)) notFound();
  const t = type as "font" | "clipart" | "background";
  const meta = TITLE[t]!;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          {meta.ko}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{meta.subtitle}</p>
      </header>
      <ResourcesClient type={t} />
    </div>
  );
}
