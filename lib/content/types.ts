/**
 * 사이트 CMS 콘텐츠 타입.
 *
 * 각 key 의 value 스키마. lib/content/defaults.ts 가 기본값(=현행 하드코딩)을
 * 제공하고, DB(site_content)에 값이 있으면 그것으로 덮어쓴다.
 *
 * 클라/서버 공용 (순수 타입·값만).
 */

export interface HeroContent {
  kicker: string;
  titleLine1: string;
  titleAccent: string;
  titleLine2: string;
  sub: string;
  badges: string[];
  ctaPrimaryLabel: string;
  ctaPrimaryHref: string;
  ctaSecondaryLabel: string;
  ctaSecondaryHref: string;
  bgImage: string;
  floating: { image: string; caption: string }[];
}

export interface StatItem {
  num: string;
  label: string;
}

export interface FeatureItem {
  num: string;
  title: string;
  desc: string;
  image: string;
  alt: string;
}

export interface SizeItem {
  name: string;
  size: string;
  desc: string;
  ratio: string;
  image: string;
  alt: string;
}

export interface GalleryContent {
  heading: string;
  sub: string;
  images: { src: string; rowSpan?: boolean }[];
}

export interface ReviewItem {
  name: string;
  rating: number;
  text: string;
}

export interface CtaContent {
  title: string;
  accent: string;
  sub: string;
  image: string;
  primaryLabel: string;
  primaryHref: string;
}

export interface FooterLink {
  label: string;
  href: string;
}
export interface FooterContent {
  tagline: string;
  groups: { title: string; links: FooterLink[] }[];
  copyright: string;
}

export interface HeaderNavItem {
  label: string;
  href: string;
}
export interface HeaderContent {
  brand: string;
  nav: HeaderNavItem[];
}

/** key → value 타입 매핑. */
export interface SiteContentMap {
  "home.hero": HeroContent;
  "home.stats": StatItem[];
  "home.features": FeatureItem[];
  "home.sizes": SizeItem[];
  "home.gallery": GalleryContent;
  "home.reviews": ReviewItem[];
  "home.cta": CtaContent;
  footer: FooterContent;
  header: HeaderContent;
}

export type SiteContentKey = keyof SiteContentMap;
