import ChromeGate from "@/components/layout/ChromeGate";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";

export default function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 캔버스 편집 화면(/cover/[id], /editor/[id]/pages/[pageId])은 자체 sticky 툴바를 쓰므로
  // ChromeGate 가 사이트 Header·Footer 를 숨긴다. <main> 랜드마크는 모든 화면에 유지한다.
  return (
    <>
      <ChromeGate>
        <Header />
      </ChromeGate>
      <main className="flex-1">{children}</main>
      <ChromeGate>
        <Footer />
      </ChromeGate>
    </>
  );
}
