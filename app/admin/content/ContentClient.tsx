"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import type {
  CtaContent,
  FeatureItem,
  FooterContent,
  GalleryContent,
  HeaderContent,
  HeroContent,
  ReviewItem,
  SiteContentMap,
  SizeItem,
  StatItem,
} from "@/lib/content/types";

// ---------------------------------------------------------------------------
// Section metadata
// ---------------------------------------------------------------------------

type SectionKey = keyof SiteContentMap;

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "home.hero", label: "히어로" },
  { key: "home.stats", label: "통계" },
  { key: "home.features", label: "특징" },
  { key: "home.sizes", label: "사이즈" },
  { key: "home.gallery", label: "갤러리" },
  { key: "home.reviews", label: "리뷰" },
  { key: "home.cta", label: "CTA" },
  { key: "footer", label: "푸터" },
  { key: "header", label: "헤더" },
];

// ---------------------------------------------------------------------------
// ImageField — 이미지 URL 입력 + 파일 업로드
// ---------------------------------------------------------------------------

interface ImageFieldProps {
  label: string;
  value: string;
  section: string;
  onChange: (url: string) => void;
}

function ImageField({ label, value, section, onChange }: ImageFieldProps) {
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("section", section);
      const r = await fetch("/api/admin/content/upload", {
        method: "POST",
        body: fd,
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.url) {
        toast({
          variant: "destructive",
          title: "업로드 실패",
          description: j?.error ?? "알 수 없는 오류",
        });
        return;
      }
      onChange(j.url as string);
      toast({ variant: "success", title: "이미지가 업로드되었습니다." });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <span className="block text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt={label}
          className="h-24 w-auto rounded-lg border border-hairline object-cover"
        />
      ) : (
        <div className="flex h-24 w-36 items-center justify-center rounded-lg border border-dashed border-hairline bg-muted/30 text-xs text-muted-foreground">
          이미지 없음
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://..."
          className="h-9 min-w-0 flex-1 text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 whitespace-nowrap text-xs"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? "업로드 중…" : "파일 선택"}
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field wrapper
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Save button row
// ---------------------------------------------------------------------------

function SaveRow({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex justify-end border-t pt-4">
      <Button
        type="button"
        variant="coral"
        size="sm"
        disabled={busy}
        onClick={onSave}
      >
        {busy ? "저장 중…" : "저장"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section editors
// ---------------------------------------------------------------------------

// ---- Hero ----

function HeroEditor({
  value,
  onChange,
}: {
  value: HeroContent;
  onChange: (v: HeroContent) => void;
}) {
  const set = <K extends keyof HeroContent>(k: K, v: HeroContent[K]) =>
    onChange({ ...value, [k]: v });

  const setBadge = (i: number, text: string) => {
    const next = [...value.badges];
    next[i] = text;
    set("badges", next);
  };
  const addBadge = () => set("badges", [...value.badges, ""]);
  const removeBadge = (i: number) =>
    set(
      "badges",
      value.badges.filter((_, idx) => idx !== i),
    );

  const setFloating = (
    i: number,
    field: "image" | "caption",
    v: string,
  ) => {
    const next = value.floating.map((f, idx) =>
      idx === i ? { ...f, [field]: v } : f,
    );
    set("floating", next);
  };
  const addFloating = () =>
    set("floating", [...value.floating, { image: "", caption: "" }]);
  const removeFloating = (i: number) =>
    set(
      "floating",
      value.floating.filter((_, idx) => idx !== i),
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Kicker">
          <Input
            value={value.kicker}
            onChange={(e) => set("kicker", e.target.value)}
            className="h-9 text-sm"
          />
        </Field>
        <Field label="타이틀 1줄">
          <Input
            value={value.titleLine1}
            onChange={(e) => set("titleLine1", e.target.value)}
            className="h-9 text-sm"
          />
        </Field>
        <Field label="타이틀 강조">
          <Input
            value={value.titleAccent}
            onChange={(e) => set("titleAccent", e.target.value)}
            className="h-9 text-sm"
          />
        </Field>
        <Field label="타이틀 2줄">
          <Input
            value={value.titleLine2}
            onChange={(e) => set("titleLine2", e.target.value)}
            className="h-9 text-sm"
          />
        </Field>
      </div>

      <Field label="서브 문구">
        <textarea
          value={value.sub}
          onChange={(e) => set("sub", e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="CTA 주버튼 라벨">
          <Input
            value={value.ctaPrimaryLabel}
            onChange={(e) => set("ctaPrimaryLabel", e.target.value)}
            className="h-9 text-sm"
          />
        </Field>
        <Field label="CTA 주버튼 링크">
          <Input
            value={value.ctaPrimaryHref}
            onChange={(e) => set("ctaPrimaryHref", e.target.value)}
            className="h-9 text-sm"
          />
        </Field>
        <Field label="CTA 보조버튼 라벨">
          <Input
            value={value.ctaSecondaryLabel}
            onChange={(e) => set("ctaSecondaryLabel", e.target.value)}
            className="h-9 text-sm"
          />
        </Field>
        <Field label="CTA 보조버튼 링크">
          <Input
            value={value.ctaSecondaryHref}
            onChange={(e) => set("ctaSecondaryHref", e.target.value)}
            className="h-9 text-sm"
          />
        </Field>
      </div>

      <ImageField
        label="배경 이미지"
        value={value.bgImage}
        section="hero"
        onChange={(url) => set("bgImage", url)}
      />

      {/* 배지 */}
      <div>
        <span className="block text-[11px] font-medium text-muted-foreground">
          배지 목록
        </span>
        <div className="mt-2 space-y-2">
          {value.badges.map((b, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={b}
                onChange={(e) => setBadge(i, e.target.value)}
                className="h-9 flex-1 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-destructive"
                onClick={() => removeBadge(i)}
              >
                삭제
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 text-xs"
            onClick={addBadge}
          >
            + 배지 추가
          </Button>
        </div>
      </div>

      {/* 플로팅 이미지 */}
      <div>
        <span className="block text-[11px] font-medium text-muted-foreground">
          플로팅 이미지
        </span>
        <div className="mt-2 space-y-3">
          {value.floating.map((f, i) => (
            <div
              key={i}
              className="rounded-xl border border-hairline p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  플로팅 {i + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-destructive"
                  onClick={() => removeFloating(i)}
                >
                  삭제
                </Button>
              </div>
              <ImageField
                label="이미지"
                value={f.image}
                section="hero"
                onChange={(url) => setFloating(i, "image", url)}
              />
              <Field label="캡션">
                <Input
                  value={f.caption}
                  onChange={(e) => setFloating(i, "caption", e.target.value)}
                  className="h-9 text-sm"
                />
              </Field>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 text-xs"
            onClick={addFloating}
          >
            + 플로팅 추가
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- Stats ----

function StatsEditor({
  value,
  onChange,
}: {
  value: StatItem[];
  onChange: (v: StatItem[]) => void;
}) {
  const setItem = (i: number, field: keyof StatItem, v: string) => {
    const next = value.map((s, idx) =>
      idx === i ? { ...s, [field]: v } : s,
    );
    onChange(next);
  };
  const add = () => onChange([...value, { num: "", label: "" }]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      {value.map((s, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-xl border border-hairline p-3"
        >
          <div className="flex-1 grid grid-cols-2 gap-2">
            <Field label="수치 (예: 5,000+)">
              <Input
                value={s.num}
                onChange={(e) => setItem(i, "num", e.target.value)}
                className="h-9 text-sm"
              />
            </Field>
            <Field label="라벨">
              <Input
                value={s.label}
                onChange={(e) => setItem(i, "label", e.target.value)}
                className="h-9 text-sm"
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-5 h-9 px-2 text-xs text-destructive"
            onClick={() => remove(i)}
          >
            삭제
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 text-xs"
        onClick={add}
      >
        + 항목 추가
      </Button>
    </div>
  );
}

// ---- Features ----

function FeaturesEditor({
  value,
  onChange,
}: {
  value: FeatureItem[];
  onChange: (v: FeatureItem[]) => void;
}) {
  const setItem = <K extends keyof FeatureItem>(
    i: number,
    field: K,
    v: FeatureItem[K],
  ) => {
    const next = value.map((f, idx) =>
      idx === i ? { ...f, [field]: v } : f,
    );
    onChange(next);
  };
  const add = () =>
    onChange([
      ...value,
      { num: String(value.length + 1).padStart(2, "0"), title: "", desc: "", image: "", alt: "" },
    ]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      {value.map((f, i) => (
        <div
          key={i}
          className="rounded-xl border border-hairline p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              특징 {f.num}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive"
              onClick={() => remove(i)}
            >
              삭제
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="번호 (예: 01)">
              <Input
                value={f.num}
                onChange={(e) => setItem(i, "num", e.target.value)}
                className="h-9 text-sm"
              />
            </Field>
            <Field label="제목">
              <Input
                value={f.title}
                onChange={(e) => setItem(i, "title", e.target.value)}
                className="h-9 text-sm"
              />
            </Field>
          </div>
          <Field label="설명">
            <textarea
              value={f.desc}
              onChange={(e) => setItem(i, "desc", e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>
          <ImageField
            label="이미지"
            value={f.image}
            section="features"
            onChange={(url) => setItem(i, "image", url)}
          />
          <Field label="이미지 alt">
            <Input
              value={f.alt}
              onChange={(e) => setItem(i, "alt", e.target.value)}
              className="h-9 text-sm"
            />
          </Field>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 text-xs"
        onClick={add}
      >
        + 특징 추가
      </Button>
    </div>
  );
}

// ---- Sizes ----

function SizesEditor({
  value,
  onChange,
}: {
  value: SizeItem[];
  onChange: (v: SizeItem[]) => void;
}) {
  const setItem = <K extends keyof SizeItem>(
    i: number,
    field: K,
    v: SizeItem[K],
  ) => {
    const next = value.map((s, idx) =>
      idx === i ? { ...s, [field]: v } : s,
    );
    onChange(next);
  };
  const add = () =>
    onChange([
      ...value,
      { name: "", size: "", desc: "", ratio: "1/1", image: "", alt: "" },
    ]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      {value.map((s, i) => (
        <div
          key={i}
          className="rounded-xl border border-hairline p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              사이즈 {i + 1}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive"
              onClick={() => remove(i)}
            >
              삭제
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="이름 (예: 미니)">
              <Input
                value={s.name}
                onChange={(e) => setItem(i, "name", e.target.value)}
                className="h-9 text-sm"
              />
            </Field>
            <Field label="사이즈 (예: 96×128mm)">
              <Input
                value={s.size}
                onChange={(e) => setItem(i, "size", e.target.value)}
                className="h-9 text-sm"
              />
            </Field>
            <Field label="설명">
              <Input
                value={s.desc}
                onChange={(e) => setItem(i, "desc", e.target.value)}
                className="h-9 text-sm"
              />
            </Field>
            <Field label="비율 (예: 3/5, 1/1)">
              <Input
                value={s.ratio}
                onChange={(e) => setItem(i, "ratio", e.target.value)}
                className="h-9 text-sm"
              />
            </Field>
          </div>
          <ImageField
            label="이미지"
            value={s.image}
            section="sizes"
            onChange={(url) => setItem(i, "image", url)}
          />
          <Field label="이미지 alt">
            <Input
              value={s.alt}
              onChange={(e) => setItem(i, "alt", e.target.value)}
              className="h-9 text-sm"
            />
          </Field>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 text-xs"
        onClick={add}
      >
        + 사이즈 추가
      </Button>
    </div>
  );
}

// ---- Gallery ----

function GalleryEditor({
  value,
  onChange,
}: {
  value: GalleryContent;
  onChange: (v: GalleryContent) => void;
}) {
  const set = <K extends keyof GalleryContent>(k: K, v: GalleryContent[K]) =>
    onChange({ ...value, [k]: v });

  const setImage = (i: number, src: string) => {
    const next = value.images.map((img, idx) =>
      idx === i ? { ...img, src } : img,
    );
    set("images", next);
  };
  const toggleRowSpan = (i: number) => {
    const next = value.images.map((img, idx) =>
      idx === i ? { ...img, rowSpan: !img.rowSpan } : img,
    );
    set("images", next);
  };
  const removeImage = (i: number) =>
    set(
      "images",
      value.images.filter((_, idx) => idx !== i),
    );
  const addImage = () =>
    set("images", [...value.images, { src: "" }]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="제목">
          <Input
            value={value.heading}
            onChange={(e) => set("heading", e.target.value)}
            className="h-9 text-sm"
          />
        </Field>
        <Field label="서브 문구">
          <Input
            value={value.sub}
            onChange={(e) => set("sub", e.target.value)}
            className="h-9 text-sm"
          />
        </Field>
      </div>

      <div>
        <span className="block text-[11px] font-medium text-muted-foreground">
          갤러리 이미지
        </span>
        <div className="mt-2 space-y-3">
          {value.images.map((img, i) => (
            <div
              key={i}
              className="rounded-xl border border-hairline p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  이미지 {i + 1}
                </span>
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={!!img.rowSpan}
                      onChange={() => toggleRowSpan(i)}
                      className="h-3 w-3"
                    />
                    rowSpan (세로 2칸)
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive"
                    onClick={() => removeImage(i)}
                  >
                    삭제
                  </Button>
                </div>
              </div>
              <ImageField
                label="이미지 URL"
                value={img.src}
                section="gallery"
                onChange={(url) => setImage(i, url)}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 text-xs"
            onClick={addImage}
          >
            + 이미지 추가
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- Reviews ----

function ReviewsEditor({
  value,
  onChange,
}: {
  value: ReviewItem[];
  onChange: (v: ReviewItem[]) => void;
}) {
  const setItem = <K extends keyof ReviewItem>(
    i: number,
    field: K,
    v: ReviewItem[K],
  ) => {
    const next = value.map((r, idx) =>
      idx === i ? { ...r, [field]: v } : r,
    );
    onChange(next);
  };
  const add = () =>
    onChange([...value, { name: "", rating: 5, text: "" }]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      {value.map((r, i) => (
        <div
          key={i}
          className="rounded-xl border border-hairline p-4 space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              리뷰 {i + 1}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive"
              onClick={() => remove(i)}
            >
              삭제
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="이름">
              <Input
                value={r.name}
                onChange={(e) => setItem(i, "name", e.target.value)}
                className="h-9 text-sm"
              />
            </Field>
            <Field label="별점 (1~5)">
              <Input
                type="number"
                value={r.rating}
                min={1}
                max={5}
                onChange={(e) => setItem(i, "rating", Number(e.target.value))}
                className="h-9 text-sm"
              />
            </Field>
          </div>
          <Field label="리뷰 내용">
            <textarea
              value={r.text}
              onChange={(e) => setItem(i, "text", e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 text-xs"
        onClick={add}
      >
        + 리뷰 추가
      </Button>
    </div>
  );
}

// ---- CTA ----

function CtaEditor({
  value,
  onChange,
}: {
  value: CtaContent;
  onChange: (v: CtaContent) => void;
}) {
  const set = <K extends keyof CtaContent>(k: K, v: CtaContent[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="제목">
          <Input
            value={value.title}
            onChange={(e) => set("title", e.target.value)}
            className="h-9 text-sm"
          />
        </Field>
        <Field label="강조 문구">
          <Input
            value={value.accent}
            onChange={(e) => set("accent", e.target.value)}
            className="h-9 text-sm"
          />
        </Field>
      </div>
      <Field label="서브 문구">
        <textarea
          value={value.sub}
          onChange={(e) => set("sub", e.target.value)}
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="버튼 라벨">
          <Input
            value={value.primaryLabel}
            onChange={(e) => set("primaryLabel", e.target.value)}
            className="h-9 text-sm"
          />
        </Field>
        <Field label="버튼 링크">
          <Input
            value={value.primaryHref}
            onChange={(e) => set("primaryHref", e.target.value)}
            className="h-9 text-sm"
          />
        </Field>
      </div>
      <ImageField
        label="배경 이미지"
        value={value.image}
        section="cta"
        onChange={(url) => set("image", url)}
      />
    </div>
  );
}

// ---- Footer ----

function FooterEditor({
  value,
  onChange,
}: {
  value: FooterContent;
  onChange: (v: FooterContent) => void;
}) {
  const set = <K extends keyof FooterContent>(k: K, v: FooterContent[K]) =>
    onChange({ ...value, [k]: v });

  const setGroupTitle = (gi: number, title: string) => {
    const next = value.groups.map((g, idx) =>
      idx === gi ? { ...g, title } : g,
    );
    set("groups", next);
  };
  const setLink = (gi: number, li: number, field: "label" | "href", v: string) => {
    const next = value.groups.map((g, gidx) => {
      if (gidx !== gi) return g;
      const links = g.links.map((l, lidx) =>
        lidx === li ? { ...l, [field]: v } : l,
      );
      return { ...g, links };
    });
    set("groups", next);
  };
  const addLink = (gi: number) => {
    const next = value.groups.map((g, gidx) => {
      if (gidx !== gi) return g;
      return { ...g, links: [...g.links, { label: "", href: "" }] };
    });
    set("groups", next);
  };
  const removeLink = (gi: number, li: number) => {
    const next = value.groups.map((g, gidx) => {
      if (gidx !== gi) return g;
      return { ...g, links: g.links.filter((_, lidx) => lidx !== li) };
    });
    set("groups", next);
  };
  const addGroup = () =>
    set("groups", [...value.groups, { title: "", links: [] }]);
  const removeGroup = (gi: number) =>
    set("groups", value.groups.filter((_, idx) => idx !== gi));

  return (
    <div className="space-y-4">
      <Field label="태그라인">
        <textarea
          value={value.tagline}
          onChange={(e) => set("tagline", e.target.value)}
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </Field>
      <Field label="저작권 텍스트">
        <Input
          value={value.copyright}
          onChange={(e) => set("copyright", e.target.value)}
          className="h-9 text-sm"
        />
      </Field>

      <div>
        <span className="block text-[11px] font-medium text-muted-foreground">
          링크 그룹
        </span>
        <div className="mt-2 space-y-3">
          {value.groups.map((g, gi) => (
            <div
              key={gi}
              className="rounded-xl border border-hairline p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <Field label="그룹 제목">
                  <Input
                    value={g.title}
                    onChange={(e) => setGroupTitle(gi, e.target.value)}
                    className="h-9 text-sm"
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-2 mt-4 h-9 px-2 text-xs text-destructive"
                  onClick={() => removeGroup(gi)}
                >
                  그룹 삭제
                </Button>
              </div>
              <div className="space-y-2">
                {g.links.map((l, li) => (
                  <div key={li} className="flex gap-2">
                    <Input
                      value={l.label}
                      onChange={(e) => setLink(gi, li, "label", e.target.value)}
                      placeholder="라벨"
                      className="h-9 flex-1 text-sm"
                    />
                    <Input
                      value={l.href}
                      onChange={(e) => setLink(gi, li, "href", e.target.value)}
                      placeholder="/경로"
                      className="h-9 flex-1 text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 px-2 text-xs text-destructive"
                      onClick={() => removeLink(gi, li)}
                    >
                      삭제
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => addLink(gi)}
                >
                  + 링크 추가
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 text-xs"
            onClick={addGroup}
          >
            + 그룹 추가
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- Header ----

function HeaderEditor({
  value,
  onChange,
}: {
  value: HeaderContent;
  onChange: (v: HeaderContent) => void;
}) {
  const set = <K extends keyof HeaderContent>(k: K, v: HeaderContent[K]) =>
    onChange({ ...value, [k]: v });

  const setNav = (i: number, field: "label" | "href", v: string) => {
    const next = value.nav.map((n, idx) =>
      idx === i ? { ...n, [field]: v } : n,
    );
    set("nav", next);
  };
  const addNav = () => set("nav", [...value.nav, { label: "", href: "" }]);
  const removeNav = (i: number) =>
    set("nav", value.nav.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      <Field label="브랜드 텍스트">
        <Input
          value={value.brand}
          onChange={(e) => set("brand", e.target.value)}
          className="h-9 text-sm"
        />
      </Field>

      <div>
        <span className="block text-[11px] font-medium text-muted-foreground">
          네비게이션
        </span>
        <div className="mt-2 space-y-2">
          {value.nav.map((n, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={n.label}
                onChange={(e) => setNav(i, "label", e.target.value)}
                placeholder="라벨"
                className="h-9 flex-1 text-sm"
              />
              <Input
                value={n.href}
                onChange={(e) => setNav(i, "href", e.target.value)}
                placeholder="/경로"
                className="h-9 flex-1 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-xs text-destructive"
                onClick={() => removeNav(i)}
              >
                삭제
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 text-xs"
            onClick={addNav}
          >
            + 메뉴 추가
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ContentClient
// ---------------------------------------------------------------------------

interface Props {
  initial: SiteContentMap;
}

export default function ContentClient({ initial }: Props) {
  const { toast } = useToast();

  // 각 섹션 draft 상태
  const [hero, setHero] = React.useState<HeroContent>(initial["home.hero"]);
  const [stats, setStats] = React.useState<StatItem[]>(initial["home.stats"]);
  const [features, setFeatures] = React.useState<FeatureItem[]>(initial["home.features"]);
  const [sizes, setSizes] = React.useState<SizeItem[]>(initial["home.sizes"]);
  const [gallery, setGallery] = React.useState<GalleryContent>(initial["home.gallery"]);
  const [reviews, setReviews] = React.useState<ReviewItem[]>(initial["home.reviews"]);
  const [cta, setCta] = React.useState<CtaContent>(initial["home.cta"]);
  const [footer, setFooter] = React.useState<FooterContent>(initial["footer"]);
  const [header, setHeader] = React.useState<HeaderContent>(initial["header"]);

  // 섹션별 저장 중 상태
  const [busyKey, setBusyKey] = React.useState<SectionKey | null>(null);

  // 현재 선택 섹션
  const [activeKey, setActiveKey] = React.useState<SectionKey>("home.hero");

  const valueOf = (key: SectionKey): SiteContentMap[SectionKey] => {
    switch (key) {
      case "home.hero": return hero;
      case "home.stats": return stats;
      case "home.features": return features;
      case "home.sizes": return sizes;
      case "home.gallery": return gallery;
      case "home.reviews": return reviews;
      case "home.cta": return cta;
      case "footer": return footer;
      case "header": return header;
    }
  };

  const save = async (key: SectionKey) => {
    setBusyKey(key);
    try {
      const r = await fetch(`/api/admin/content/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: valueOf(key) }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        toast({
          variant: "destructive",
          title: "저장 실패",
          description: j?.error ?? "알 수 없는 오류",
        });
        return;
      }
      toast({ variant: "success", title: "저장되었습니다." });
    } finally {
      setBusyKey(null);
    }
  };

  const renderEditor = () => {
    switch (activeKey) {
      case "home.hero":
        return <HeroEditor value={hero} onChange={setHero} />;
      case "home.stats":
        return <StatsEditor value={stats} onChange={setStats} />;
      case "home.features":
        return <FeaturesEditor value={features} onChange={setFeatures} />;
      case "home.sizes":
        return <SizesEditor value={sizes} onChange={setSizes} />;
      case "home.gallery":
        return <GalleryEditor value={gallery} onChange={setGallery} />;
      case "home.reviews":
        return <ReviewsEditor value={reviews} onChange={setReviews} />;
      case "home.cta":
        return <CtaEditor value={cta} onChange={setCta} />;
      case "footer":
        return <FooterEditor value={footer} onChange={setFooter} />;
      case "header":
        return <HeaderEditor value={header} onChange={setHeader} />;
    }
  };

  const activeMeta = SECTIONS.find((s) => s.key === activeKey)!;

  return (
    <div className="flex min-h-0 gap-0 rounded-2xl border border-hairline bg-card shadow-soft md:gap-px">
      {/* 좌측 섹션 탭 */}
      <aside className="w-36 shrink-0 rounded-l-2xl border-r border-hairline bg-white/60 py-2">
        <nav>
          <ul className="space-y-0.5 px-2">
            {SECTIONS.map(({ key, label }) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setActiveKey(key)}
                  className={[
                    "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    activeKey === key
                      ? "bg-coral-50 font-medium text-coral-700"
                      : "text-foreground/80 hover:bg-muted hover:text-foreground",
                  ].join(" ")}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* 우측 편집 폼 */}
      <div className="min-w-0 flex-1 rounded-r-2xl p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold">
            {activeMeta.label}
          </h2>
          <Button
            type="button"
            variant="coral"
            size="sm"
            disabled={busyKey === activeKey}
            onClick={() => save(activeKey)}
          >
            {busyKey === activeKey ? "저장 중…" : "저장"}
          </Button>
        </div>

        <div className="overflow-y-auto">
          {renderEditor()}
        </div>

        <SaveRow
          busy={busyKey === activeKey}
          onSave={() => save(activeKey)}
        />
      </div>
    </div>
  );
}
