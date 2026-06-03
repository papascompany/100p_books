import Link from "next/link";

import { getSiteContent } from "@/lib/content/get";

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
            <p className="mt-3 text-xs text-stone">
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
                    className="text-mute hover:text-coral transition-colors"
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
