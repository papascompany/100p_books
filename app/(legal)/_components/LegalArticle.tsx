import * as React from "react";

/**
 * 법적 문서 공통 prose 래퍼.
 * h1/h2/h3, p, ol, ul, li 톤을 한국어 본문에 맞게 조정.
 */
export function LegalArticle({
  title,
  updatedAt,
  effectiveAt,
  children,
}: {
  title: string;
  /** 최종 개정일 — yyyy-mm-dd */
  updatedAt: string;
  /** 시행일 — yyyy-mm-dd. 없으면 updatedAt 와 동일. */
  effectiveAt?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="legal-article">
      <header className="mb-8 border-b border-border/60 pb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          최종 개정일: {updatedAt}
          {effectiveAt && effectiveAt !== updatedAt ? (
            <span className="ml-3">시행일: {effectiveAt}</span>
          ) : null}
        </p>
      </header>
      <div
        className={[
          "space-y-6 text-[15px] leading-relaxed text-foreground/90",
          "[&_h2]:mt-10 [&_h2]:scroll-mt-24 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight md:[&_h2]:text-2xl",
          "[&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold",
          "[&_p]:my-3",
          "[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol>li]:my-1.5",
          "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul>li]:my-1.5",
          "[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
          "[&_th]:border [&_th]:border-border/60 [&_th]:bg-muted/50 [&_th]:p-2 [&_th]:text-left",
          "[&_td]:border [&_td]:border-border/60 [&_td]:p-2 [&_td]:align-top",
          "[&_strong]:font-semibold [&_strong]:text-foreground",
        ].join(" ")}
      >
        {children}
      </div>
    </article>
  );
}
