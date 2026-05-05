"use client";

import { Download, FileDown } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface OrderPdfButtonsProps {
  initialCoverUrl: string | null;
  initialInteriorUrl: string | null;
}

/**
 * 주문 상세에서 PDF 다운로드 버튼 — 서버에서 미리 발급한 signedUrl 을 바로 사용.
 * URL TTL 이 지난 경우(1시간 이상 페이지 머무를 때) 페이지 새로고침을 안내.
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
