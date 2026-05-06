import Link from "next/link";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-[#dedede] bg-white">
      <div className="container py-10">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          {/* 브랜드 */}
          <div>
            <Link href="/" className="flex items-center gap-1.5 text-[#111111]">
              <span className="font-display-num text-2xl font-bold leading-none">100p</span>
              <span className="text-base font-semibold tracking-tight">Books</span>
            </Link>
            <p className="mt-2 text-sm text-[#707072] max-w-[28ch] leading-relaxed">
              소중한 순간을 고품질 포토북으로 남기세요.
              업로드부터 인쇄까지 한 번에.
            </p>
            <p className="mt-3 text-xs text-[#9e9ea0]">© {year} 100p Books. All rights reserved.</p>
          </div>

          {/* 링크 */}
          <nav aria-label="정책 링크" className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div className="flex flex-col gap-2">
              <p className="font-semibold text-[#111111] mb-1">서비스</p>
              <Link href="/upload" className="text-[#707072] hover:text-[#111111] transition-colors">포토북 만들기</Link>
              <Link href="/gallery" className="text-[#707072] hover:text-[#111111] transition-colors">후기 갤러리</Link>
              <Link href="/attendance" className="text-[#707072] hover:text-[#111111] transition-colors">출석체크</Link>
            </div>
            <div className="flex flex-col gap-2">
              <p className="font-semibold text-[#111111] mb-1">정책</p>
              <Link href="/terms" className="text-[#707072] hover:text-[#111111] transition-colors">이용약관</Link>
              <Link href="/privacy" className="text-[#707072] hover:text-[#111111] transition-colors">개인정보처리방침</Link>
              <Link href="/refund" className="text-[#707072] hover:text-[#111111] transition-colors">교환·환불</Link>
            </div>
          </nav>
        </div>
      </div>
    </footer>
  );
}
