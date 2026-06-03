import type { SiteContentMap } from "./types";

/**
 * 사이트 콘텐츠 기본값 — 현행 하드코딩과 동일.
 * DB(site_content)에 값이 없을 때 fallback. 따라서 마이그레이션 미적용/빈 DB
 * 상태에서도 사이트는 정상 렌더된다.
 */
export const SITE_CONTENT_DEFAULTS: SiteContentMap = {
  "home.hero": {
    kicker: "100 Photos · 1 Book",
    titleLine1: "사진만 고르세요,",
    titleAccent: "포토북은 100p가",
    titleLine2: "만들게요.",
    sub: "업로드하면 AI가 자동으로 예쁘게 배치 — 3분이면 끝나요. 편집부터 인쇄 주문까지 모두 모바일에서.",
    badges: ["무료 시작", "300dpi 인쇄", "3~5일 배송"],
    ctaPrimaryLabel: "지금 만들기",
    ctaPrimaryHref: "/upload",
    ctaSecondaryLabel: "후기 갤러리",
    ctaSecondaryHref: "/gallery",
    bgImage:
      "https://images.unsplash.com/photo-1530538987395-032d1800fdd4?w=1920&q=80",
    floating: [
      {
        image:
          "https://images.unsplash.com/photo-1606159068539-43f36b99d1b2?w=400&q=75",
        caption: "우리의 여행",
      },
      {
        image:
          "https://images.unsplash.com/photo-1495640388908-05fa85288e61?w=400&q=75",
        caption: "가족의 순간",
      },
    ],
  },

  "home.stats": [
    { num: "5,000+", label: "제작된 포토북" },
    { num: "4.9★", label: "평균 별점" },
    { num: "300dpi", label: "인쇄 해상도" },
    { num: "3~5일", label: "평균 배송일" },
  ],

  "home.features": [
    {
      num: "01",
      title: "자동 레이아웃",
      desc: "사진을 올리면 찍은 순서대로 자동 정렬. 페이지 구성까지 한 번에 완성돼요.",
      image:
        "https://images.unsplash.com/photo-1606159068539-43f36b99d1b2?w=900&q=80",
      alt: "폴라로이드 사진들이 가지런히 정렬된 모습",
    },
    {
      num: "02",
      title: "감성 편집 에디터",
      desc: "콜라주, 여백, 글씨, 스티커까지. 모바일에서도 내 취향대로 꾸밀 수 있어요.",
      image:
        "https://images.unsplash.com/photo-1530538987395-032d1800fdd4?w=900&q=80",
      alt: "빈티지한 분위기로 펼쳐진 사진 앨범",
    },
    {
      num: "03",
      title: "집 앞까지 배송",
      desc: "전문 인쇄소에서 고품질로 제작해 3~5일 안에 보내드려요.",
      image:
        "https://images.unsplash.com/photo-1532012197267-da84d127e765?w=900&q=80",
      alt: "고품질 인쇄로 펼쳐진 사진집의 디테일",
    },
  ],

  "home.sizes": [
    {
      name: "미니",
      size: "96×128mm",
      desc: "손에 쏙 들어오는 작은 책",
      ratio: "3/5",
      image:
        "https://images.unsplash.com/photo-1495640388908-05fa85288e61?w=900&q=80",
      alt: "손에 쏙 들어오는 작은 사진집",
    },
    {
      name: "스퀘어",
      size: "148×148mm",
      desc: "SNS 감성 정사각형 포맷",
      ratio: "1/1",
      image:
        "https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=900&q=80",
      alt: "정사각형 포맷의 감성 사진집",
    },
    {
      name: "A5",
      size: "148×210mm",
      desc: "일반 노트 사이즈, 넉넉한 여백",
      ratio: "3/5",
      image:
        "https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=900&q=80",
      alt: "A5 사이즈의 펼쳐진 화보집",
    },
  ],

  "home.gallery": {
    heading: "실제 포토북 후기",
    sub: "100p Books로 만든 실제 고객들의 포토북입니다.",
    images: [
      { src: "https://images.unsplash.com/photo-1606159068539-43f36b99d1b2?w=600&q=75", rowSpan: true },
      { src: "https://images.unsplash.com/photo-1495640388908-05fa85288e61?w=600&q=75" },
      { src: "https://images.unsplash.com/photo-1532012197267-da84d127e765?w=600&q=75" },
      { src: "https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=600&q=75", rowSpan: true },
      { src: "https://images.unsplash.com/photo-1530538987395-032d1800fdd4?w=600&q=75" },
      { src: "https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=600&q=75" },
    ],
  },

  "home.reviews": [
    { name: "김지현", rating: 5, text: "결혼기념일 선물로 주문했는데 너무 예쁘게 나왔어요! 남편이 감동받았습니다." },
    { name: "박서준", rating: 5, text: "여행 사진 100장으로 포토북 만들었는데 퀄리티가 정말 좋네요. 다음 여행도 꼭 만들 것 같아요." },
    { name: "이수아", rating: 5, text: "아기 첫돌 기념으로 제작했어요. 인쇄 색감이 선명하고 종이 질도 두껍고 좋아요!" },
  ],

  "home.cta": {
    title: "100장의 순간을",
    accent: "한 권의 감성으로.",
    sub: "지금 사진을 올리면 3분 안에 첫 페이지가 완성됩니다. 무료로 시작할 수 있어요.",
    image:
      "https://images.unsplash.com/photo-1532012197267-da84d127e765?w=1200&q=60",
    primaryLabel: "무료로 만들기",
    primaryHref: "/upload",
  },

  footer: {
    tagline: "소중한 순간을 고품질 포토북으로 남기세요. 업로드부터 인쇄까지 한 번에.",
    groups: [
      {
        title: "서비스",
        links: [
          { label: "포토북 만들기", href: "/upload" },
          { label: "후기 갤러리", href: "/gallery" },
          { label: "출석체크", href: "/attendance" },
        ],
      },
      {
        title: "정책",
        links: [
          { label: "이용약관", href: "/terms" },
          { label: "개인정보처리방침", href: "/privacy" },
          { label: "교환·환불", href: "/refund" },
        ],
      },
    ],
    copyright: "100p Books. All rights reserved.",
  },

  header: {
    brand: "Books",
    nav: [
      { label: "갤러리", href: "/gallery" },
      { label: "출석체크", href: "/attendance" },
      { label: "내 포토북", href: "/projects" },
      { label: "만들기", href: "/upload" },
    ],
  },
};
