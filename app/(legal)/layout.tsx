import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";

/**
 * (legal) 라우트 그룹 — /terms, /privacy, /refund.
 *
 * - 좁은 prose 컨테이너 (max-w-3xl)
 * - 헤더/푸터는 (user) 와 동일
 * - 인쇄 친화: 본문만 보이도록 헤더/푸터 숨김
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="print:hidden">
        <Header />
      </div>
      <main className="flex-1">
        <div className="container mx-auto max-w-3xl px-4 py-10 md:py-16 print:py-4">
          {children}
        </div>
      </main>
      <div className="print:hidden">
        <Footer />
      </div>
    </>
  );
}
