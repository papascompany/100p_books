import { getSiteContentMany } from "@/lib/content/get";
import type { SiteContentKey } from "@/lib/content/types";

import ContentClient from "./ContentClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALL_KEYS: SiteContentKey[] = [
  "home.hero",
  "home.stats",
  "home.features",
  "home.sizes",
  "home.gallery",
  "home.reviews",
  "home.cta",
  "footer",
  "header",
];

export default async function AdminContentPage() {
  const initial = await getSiteContentMany(ALL_KEYS);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          사이트 콘텐츠
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          히어로·통계·특징·사이즈·갤러리·리뷰·CTA·푸터·헤더 텍스트와 이미지를 관리합니다.
          저장하면 즉시 반영됩니다.
        </p>
      </header>
      <ContentClient initial={initial} />
    </div>
  );
}
