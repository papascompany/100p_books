import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center bg-canvas px-4 py-16">
      <div className="max-w-md text-center">
        <p className="font-display-num text-[96px] leading-[0.9] text-hairline">
          404
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          페이지를 찾을 수 없어요
        </h1>
        <p className="mt-3 text-mute">
          주소가 잘못되었거나, 페이지가 이동·삭제되었을 수 있어요.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild variant="coral" size="lg">
            <Link href="/">홈으로 가기</Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/upload">포토북 만들기</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
