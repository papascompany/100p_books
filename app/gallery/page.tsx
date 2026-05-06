import type { Metadata } from "next";

import GalleryClient from "./GalleryClient";

export const metadata: Metadata = {
  title: "후기 갤러리 | 100p Books",
  description:
    "100p Books 고객들의 실제 포토북 후기를 확인하세요. 별점, 사진, 텍스트 후기로 나만의 포토북 제작에 영감을 받으세요.",
  openGraph: {
    title: "후기 갤러리 | 100p Books",
    description: "100p Books 고객들의 실제 포토북 후기를 확인하세요.",
    type: "website",
  },
};

// ISR: 60초마다 재생성 (force-dynamic 대비 첫 방문자도 캐시 히트)
export const revalidate = 60;

interface ReviewItem {
  id: string;
  rating: number;
  body: string | null;
  imageUrls: string[];
  likesCount: number;
  isLiked: boolean;
  authorName: string;
  authorId: string;
  createdAt: string;
  isMine: boolean;
}

interface ReviewListResponse {
  items: ReviewItem[];
  nextCursor: string | null;
}

async function getInitialReviews(): Promise<ReviewListResponse> {
  try {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const url = `${base}/api/reviews?sort=recent&limit=12`;

    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return { items: [], nextCursor: null };

    const json = (await res.json()) as {
      ok: boolean;
      data?: ReviewListResponse;
    };
    if (!json.ok || !json.data) return { items: [], nextCursor: null };
    return json.data;
  } catch {
    return { items: [], nextCursor: null };
  }
}

export default async function GalleryPage() {
  const initial = await getInitialReviews();

  return (
    <div className="container mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          후기 갤러리
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          실제 고객들의 포토북 후기를 확인해 보세요.
        </p>
      </header>

      <GalleryClient
        initialItems={initial.items}
        initialNextCursor={initial.nextCursor}
      />
    </div>
  );
}
