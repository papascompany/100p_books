"use client";

import { Download, FileDown } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface OrderPdfButtonsProps {
  initialCoverUrl: string | null;
  initialInteriorUrl: string | null;
}

/**
 * 주문 상세 PDF 다운로드 버튼.
 * href 는 서버 프록시 경로(/api/orders/:id/download/:kind) — 요청 시점에 서버가
 * 인증 후 Storige(또는 레거시 Supabase)에서 스트리밍하므로 TTL 만료가 없다.
 */
export default function OrderPdfButtons(props: OrderPdfButtonsProps) {
  const hasAny = !!(props.initialCoverUrl || props.initialInteriorUrl);
  if (!hasAny) {
    return (
      <p className="mt-2 text-sm text-muted-foreground">
        PDF 파일이 아직 준비되지 않았습니다. 잠시 후 새로고침해주세요.
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {props.initialCoverUrl ? (
        <Button asChild variant="outline" size="sm">
          <a href={props.initialCoverUrl} rel="noopener">
            <FileDown />
            표지 PDF
          </a>
        </Button>
      ) : null}
      {props.initialInteriorUrl ? (
        <Button asChild variant="outline" size="sm">
          <a href={props.initialInteriorUrl} rel="noopener">
            <FileDown />
            내지 PDF
          </a>
        </Button>
      ) : null}
      {props.initialCoverUrl && props.initialInteriorUrl ? (
        <Button asChild variant="gradient" size="sm">
          <a
            href={props.initialInteriorUrl}
            onClick={(e) => {
              // 두 파일 동시 다운로드 — 일부 브라우저는 팝업 차단. 차선책으로 a.click 두 번.
              if (props.initialCoverUrl) {
                const a = document.createElement("a");
                a.href = props.initialCoverUrl;
                a.rel = "noopener";
                document.body.appendChild(a);
                setTimeout(() => {
                  a.click();
                  a.remove();
                }, 300);
              }
              // 기본 동작 — interiorUrl 다운로드 진행
              void e;
            }}
            rel="noopener"
          >
            <Download />
            전체 다운로드
          </a>
        </Button>
      ) : null}
    </div>
  );
}
