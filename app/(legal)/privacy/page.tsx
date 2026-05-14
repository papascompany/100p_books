import type { Metadata } from "next";

import { LegalArticle } from "../_components/LegalArticle";

export const metadata: Metadata = {
  title: "개인정보 처리방침",
  description:
    "100p Books가 수집·이용하는 개인정보의 항목, 목적, 보유 기간, 위탁, 이용자의 권리 및 행사 방법을 안내합니다.",
  robots: { index: true, follow: true },
};

// 처리방침은 정적 콘텐츠 → 빌드 시 prerender + CDN 캐시.
export const dynamic = "force-static";
export const revalidate = false;

export default function PrivacyPage() {
  return (
    <LegalArticle title="개인정보 처리방침" updatedAt="2026-05-05">
      <p>
        100p Books(이하 &ldquo;회사&rdquo;)는 「개인정보 보호법」 및 「정보통신망
        이용촉진 및 정보보호 등에 관한 법률」 등 관련 법령을 준수하며, 이용자의
        개인정보를 안전하게 처리하기 위하여 다음과 같이 개인정보 처리방침을
        수립·공개합니다.
      </p>

      <h2 id="section-1">1. 수집하는 개인정보 항목</h2>
      <p>회사는 다음의 항목을 수집·이용합니다.</p>
      <ul>
        <li>
          <strong>회원가입·로그인:</strong> 이메일, 프로필명(선택), 로그인 기록
          (접속 IP, 일시, 브라우저 정보)
        </li>
        <li>
          <strong>주문·결제:</strong> 수령인 이름, 휴대전화 번호, 우편번호,
          기본주소·상세주소, 배송 메모, 결제정보(결제 금액, 결제수단,
          PG사 결제 키 ―{" "}
          <strong>카드번호 등 결제수단 자체는 회사에 저장하지 않습니다</strong>)
        </li>
        <li>
          <strong>업로드 사진의 기술 메타데이터(EXIF):</strong> 촬영 일시,
          카메라 모델. <strong>GPS 위치 정보는 수집·저장하지 않으며,</strong>{" "}
          업로드 시 클라이언트와 서버에서 모두 제거합니다.
        </li>
        <li>
          <strong>고객 문의:</strong> 문의 내용, 회신용 이메일 주소
        </li>
      </ul>

      <h2 id="section-2">2. 개인정보의 수집·이용 목적</h2>
      <ol>
        <li>회원관리 — 회원 식별, 본인확인, 부정이용 방지</li>
        <li>서비스 제공 — 포토북 디자인·인쇄·배송, PDF 결과물 제공</li>
        <li>결제·정산 — 주문 결제, 환불 처리</li>
        <li>고객응대 — 문의 응답, 분쟁 처리, 공지사항 전달</li>
        <li>법령 준수 — 전자상거래법 등 관계 법령상의 의무 이행</li>
      </ol>

      <h2 id="section-3">3. 개인정보의 보유·이용 기간</h2>
      <p>
        회사는 원칙적으로 개인정보의 수집·이용 목적이 달성되거나 회원이 탈퇴를
        요청한 경우 지체 없이 해당 정보를 파기합니다. 단, 다음의 경우 관계
        법령에 따라 일정 기간 보존합니다.
      </p>
      <table>
        <thead>
          <tr>
            <th>항목</th>
            <th>보존 근거</th>
            <th>보존 기간</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>계약 또는 청약철회 등에 관한 기록</td>
            <td>전자상거래법</td>
            <td>5년</td>
          </tr>
          <tr>
            <td>대금결제 및 재화 등의 공급에 관한 기록</td>
            <td>전자상거래법</td>
            <td>5년</td>
          </tr>
          <tr>
            <td>소비자의 불만 또는 분쟁처리에 관한 기록</td>
            <td>전자상거래법</td>
            <td>3년</td>
          </tr>
          <tr>
            <td>웹사이트 방문 기록(로그인 기록 등)</td>
            <td>통신비밀보호법</td>
            <td>3개월</td>
          </tr>
        </tbody>
      </table>
      <p>
        회원 탈퇴 시 프로필의 이메일·이름은 즉시 익명화(&ldquo;탈퇴회원&rdquo;)
        처리되며, 위 표의 기록은 회원 식별이 불가능한 형태로 법정 기간 동안만
        보존됩니다.
      </p>

      <h2 id="section-4">4. 개인정보의 처리 위탁</h2>
      <p>회사는 원활한 서비스 제공을 위해 다음과 같이 개인정보 처리를 위탁합니다.</p>
      <table>
        <thead>
          <tr>
            <th>수탁자</th>
            <th>위탁업무</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Supabase, Inc.</td>
            <td>회원·주문 데이터베이스 호스팅, 인증, 사진·PDF 스토리지</td>
          </tr>
          <tr>
            <td>Vercel, Inc.</td>
            <td>웹 애플리케이션 호스팅, CDN, 서버리스 함수 실행</td>
          </tr>
          <tr>
            <td>토스페이먼츠 (NHN KCP·아임포트 등 PG)</td>
            <td>결제 처리, 결제 기록 보관</td>
          </tr>
          <tr>
            <td>인쇄·배송 위탁사</td>
            <td>주문 제작, 송장 발행, 배송</td>
          </tr>
        </tbody>
      </table>

      <h2 id="section-5">5. 개인정보의 제3자 제공</h2>
      <p>
        회사는 이용자의 개인정보를 본 처리방침에서 고지한 범위를 넘어 사용하거나
        제3자에게 제공하지 않습니다. 다만 다음의 경우에는 예외로 합니다.
      </p>
      <ul>
        <li>이용자가 사전에 동의한 경우</li>
        <li>법령의 규정에 의하거나 수사 목적으로 적법한 절차에 따라 요구된 경우</li>
        <li>
          배송 위탁 시 송장 발행에 필요한 최소한의 정보(수령인, 연락처, 주소)
          전달
        </li>
      </ul>

      <h2 id="section-6">6. 정보주체(이용자)의 권리와 행사 방법</h2>
      <p>이용자는 언제든지 다음의 권리를 행사할 수 있습니다.</p>
      <ul>
        <li>개인정보의 열람·정정·삭제 요구</li>
        <li>처리정지 요구</li>
        <li>회원 탈퇴 및 동의 철회</li>
      </ul>
      <p>
        권리 행사는 마이페이지(<a href="/mypage/account">계정 관리</a>) 또는
        개인정보 보호책임자에게 서면·전자우편 등으로 요청하실 수 있으며, 회사는
        지체 없이 조치합니다.
      </p>

      <h3>회원 탈퇴 절차</h3>
      <ol>
        <li>마이페이지 → 계정 관리(<code>/mypage/account</code>) 진입</li>
        <li>
          &lsquo;회원 탈퇴&rsquo; 카드에서 본인 이메일 재입력 후 탈퇴 사유 선택
        </li>
        <li>
          탈퇴 즉시 프로필이 익명화되며, 진행 중인 주문이 있는 경우 절차 종료
          후 탈퇴가 완료됩니다.
        </li>
      </ol>

      <h2 id="section-7">7. 개인정보의 안전성 확보 조치</h2>
      <ul>
        <li>전송 구간 TLS 1.2 이상 암호화</li>
        <li>
          데이터베이스의 행 수준 보안(Row-Level Security)으로 사용자별 접근 제한
        </li>
        <li>
          관리자 권한 이중 보호(미들웨어 + 라우트 가드), 관리자 행위 로그 기록
        </li>
        <li>
          이용자 사진은 비공개 스토리지에 저장되며 짧은 만료시간을 가진
          서명 URL로만 접근
        </li>
        <li>업로드 단계에서 EXIF의 GPS 좌표 자동 제거</li>
      </ul>

      <h2 id="section-8">8. 쿠키 및 행태정보</h2>
      <p>
        회사는 로그인 세션 유지를 위해 필수 쿠키만을 사용하며, 광고·추적 목적의
        제3자 쿠키는 사용하지 않습니다. 이용자는 브라우저 설정을 통해 쿠키를
        거부할 수 있으나, 이 경우 일부 서비스 이용이 제한될 수 있습니다.
      </p>

      <h2 id="section-9">9. 개인정보 보호책임자</h2>
      <ul>
        <li>이름: 개인정보 보호책임자</li>
        <li>이메일: privacy@100pbooks.example (실제 운영 시 갱신 예정)</li>
      </ul>
      <p>
        개인정보 침해와 관련한 신고·상담이 필요하신 경우 아래 기관에
        문의하실 수 있습니다.
      </p>
      <ul>
        <li>개인정보침해신고센터 ― 국번없이 118 / privacy.kisa.or.kr</li>
        <li>개인정보 분쟁조정위원회 ― 1833-6972 / kopico.go.kr</li>
        <li>대검찰청 사이버수사과 ― 국번없이 1301 / spo.go.kr</li>
        <li>경찰청 사이버수사국 ― 국번없이 182 / ecrm.cyber.go.kr</li>
      </ul>

      <h2 id="section-10">10. 처리방침의 변경</h2>
      <p>
        본 처리방침은 시행일자 이전에 변경 사항이 있는 경우 홈페이지를 통해
        사전 공지합니다.
      </p>
    </LegalArticle>
  );
}
