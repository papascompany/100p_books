import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { LegalArticle } from "../_components/LegalArticle";

export const metadata: Metadata = {
  title: "교환·환불 정책",
  description:
    "100p Books의 청약철회 가능 기간, 환불 절차, 인쇄 불량 시 교환·재제작 기준을 안내합니다.",
  robots: { index: true, follow: true },
};

export default function RefundPage() {
  return (
    <LegalArticle title="교환·환불 정책" updatedAt="2026-05-05">
      <p>
        100p Books의 포토북은 이용자가 직접 디자인하여 주문하시는{" "}
        <strong>주문 제작 인쇄물</strong>입니다. 「전자상거래 등에서의
        소비자보호에 관한 법률」 제17조 제2항 제5호에 따라 청약철회가 제한될
        수 있으며, 본 정책은 그 구체적인 기준과 절차를 안내합니다.
      </p>

      <h2 id="section-1">1. 환불 가능 여부 요약</h2>
      <table>
        <thead>
          <tr>
            <th>주문 상태</th>
            <th>환불 가능 여부</th>
            <th>비고</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>결제 완료(paid) — 제작 시작 전</td>
            <td>
              <strong>100% 전액 환불</strong>
            </td>
            <td>마이페이지에서 즉시 요청 가능</td>
          </tr>
          <tr>
            <td>제작중(in_production) ~ 배송완료</td>
            <td>
              <strong>환불 불가</strong>
            </td>
            <td>주문 제작 인쇄물 특성상 청약철회 제한</td>
          </tr>
          <tr>
            <td>인쇄 불량 / 배송 사고 / 오배송</td>
            <td>
              <strong>전액 환불 또는 동일 사양 재제작</strong>
            </td>
            <td>회사·위탁사 귀책. 수령 후 7일 이내 신청</td>
          </tr>
        </tbody>
      </table>

      <h2 id="section-2">2. 청약철회(환불) 가능 기간</h2>
      <ol>
        <li>
          결제 완료 직후부터 <strong>주문 상태가 &lsquo;제작중&rsquo;으로
          전환되기 전까지</strong>는 사유와 관계없이 전액 환불을 요청하실 수
          있습니다.
        </li>
        <li>
          제작이 시작된 이후(주문 상태 <code>in_production</code> 이후)에는
          이용자의 단순 변심 또는 업로드 사진의 품질 문제(저해상도, 노출 부족
          등)로 인한 환불은 불가능합니다.
        </li>
        <li>
          단, 다음의 경우에는 수령 후 7일 이내 신청 시 전액 환불 또는 무상
          재제작을 받으실 수 있습니다.
          <ul>
            <li>인쇄 불량(찢어짐, 잉크 번짐, 페이지 결손 등)</li>
            <li>표지·내지의 디자인이 미리보기와 명백히 다른 경우</li>
            <li>택배사 사고로 인한 파손·오배송·분실</li>
          </ul>
        </li>
      </ol>

      <h2 id="section-3">3. 환불·교환 신청 절차</h2>
      <ol>
        <li>마이페이지 → 주문 내역 → 해당 주문 상세 진입</li>
        <li>
          &lsquo;환불 문의&rsquo; 또는 &lsquo;교환 신청&rsquo; 버튼을 통해 사유를
          작성합니다. (현재는 이메일 회신 방식, 추후 인앱 신청 폼 제공 예정)
        </li>
        <li>
          인쇄 불량·배송 사고의 경우 수령품의 사진을 첨부해 주시면 검토가
          빨라집니다.
        </li>
        <li>접수 후 영업일 기준 3일 이내에 처리 결과를 안내드립니다.</li>
      </ol>

      <h2 id="section-4">4. 환불 처리 기간 및 방법</h2>
      <ul>
        <li>
          환불 승인 후 영업일 기준 3일 이내에 결제수단(카드·계좌이체 등)으로
          환불됩니다.
        </li>
        <li>
          카드 결제의 경우 카드사 정책에 따라 환불 반영까지 추가로 3~5영업일이
          소요될 수 있습니다.
        </li>
        <li>
          현금영수증·세금계산서가 발행된 경우 동시에 취소 처리됩니다.
        </li>
      </ul>

      <h2 id="section-5">5. 색상·재단·인쇄 품질에 관한 안내</h2>
      <ul>
        <li>
          모니터·모바일 화면(RGB)과 인쇄물(CMYK)의 발색 차이로 인해 색상이
          다소 다르게 보일 수 있으며, 이는 인쇄물의 일반적인 특성으로 환불·
          재제작 사유에 해당하지 않습니다.
        </li>
        <li>
          저해상도 사진(권장 300dpi 미만)을 큰 영역에 배치하실 경우 흐릿하게
          출력될 수 있습니다. 미리보기 단계에서 화질 경고가 표시되니 확인 후
          주문해 주세요.
        </li>
        <li>
          재단선(bleed) 안쪽의 안전 영역을 벗어난 텍스트·중요 요소는 재단 시
          잘릴 수 있으니 가이드 라인 안에 배치해 주세요.
        </li>
      </ul>

      <h2 id="section-6">6. 문의처</h2>
      <p>
        교환·환불 또는 인쇄 품질에 관한 문의는 마이페이지의 주문 상세
        화면에서 신청해 주시거나, 아래 이메일로 연락 주세요.
      </p>
      <ul>
        <li>이메일: support@100pbooks.example (실제 운영 시 갱신 예정)</li>
        <li>운영시간: 평일 10:00 ~ 18:00 (점심 12:00~13:00 제외, 주말·공휴일 휴무)</li>
      </ul>

      <div className="not-prose mt-8 flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href="/mypage/orders">주문 내역 보기</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/terms">이용약관 보기</Link>
        </Button>
      </div>
    </LegalArticle>
  );
}
