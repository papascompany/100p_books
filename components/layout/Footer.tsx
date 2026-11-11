import Link from "next/link";

import { getSiteContent } from "@/lib/content/get";
// 고객센터 대표 번호 — 법정 고지 성격이라 CMS(site_content)가 아니라 코드에 고정한다(주문 안내와 공유).
import { CUSTOMER_CENTER_TEL, CUSTOMER_CENTER_TEL_HREF } from "@/lib/orders/customer-center";
import { BUSINESS_INFO, BUSINESS_INFO_CHECK_URL } from "@/lib/legal/business-info";

export default async function Footer() {
  const year = new Date().getFullYear();
  const footerContent = await getSiteContent("footer");

  return (
    <footer className="border-t border-hairline bg-canvas">
      <div className="container py-10">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          {/* 브랜드 */}
          <div>
            <Link href="/" className="flex items-center gap-1 text-ink">
              <span className="font-display-num text-2xl font-bold leading-none">
                <span>100</span><span className="text-coral">p</span>
              </span>
              <span className="text-base font-semibold tracking-tight">Books</span>
            </Link>
            <p className="mt-2 text-sm text-mute max-w-[28ch] leading-relaxed">
              {footerContent.tagline}
            </p>
            {/* 고객 문의 창구 (2026-11-06 오너 결정) */}
            <p className="mt-3 text-sm text-ink">
              고객센터{" "}
              <a
                href={CUSTOMER_CENTER_TEL_HREF}
                className="font-semibold hover:text-coral-700 dark:hover:text-coral transition-colors"
              >
                {CUSTOMER_CENTER_TEL}
              </a>
            </p>
            {/* 사업자 정보 (2026-11-07 오너 제공) */}
            <address className="mt-3 max-w-[60ch] text-xs not-italic leading-relaxed text-mute">
              <span>상호 {BUSINESS_INFO.name}</span>
              <span aria-hidden="true"> · </span>
              <span>대표자 {BUSINESS_INFO.ceo}</span>
              <span aria-hidden="true"> · </span>
              <span>사업자등록번호 {BUSINESS_INFO.registrationNo}</span>
              <br />
              <span>통신판매업 신고번호 {BUSINESS_INFO.mailOrderNo}</span>
              <span aria-hidden="true"> · </span>
              <a
                href={BUSINESS_INFO_CHECK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-coral-700 dark:hover:text-coral transition-colors"
              >
                사업자정보확인
              </a>
              <br />
              <span>주소 {BUSINESS_INFO.address}</span>
            </address>
            <p className="mt-3 text-xs text-mute">
              © {year} {footerContent.copyright}
            </p>
          </div>

          {/* 링크 그룹 */}
          <nav aria-label="정책 링크" className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {footerContent.groups.map((group) => (
              <div key={group.title} className="flex flex-col gap-2">
                <p className="font-semibold text-ink mb-1">{group.title}</p>
                {group.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-mute hover:text-coral-700 dark:hover:text-coral transition-colors"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
