import Link from "next/link";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border/60 bg-background/60">
      <div className="container flex flex-col items-start justify-between gap-4 py-8 text-sm text-muted-foreground md:flex-row md:items-center">
        <p className="font-display text-base text-foreground">
          100p Books
          <span className="ml-2 text-xs text-muted-foreground">
            © {year} 나만의 포토북
          </span>
        </p>

        <nav aria-label="정책" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/terms" className="hover:text-foreground">
            이용약관
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            개인정보처리방침
          </Link>
          <Link href="/contact" className="hover:text-foreground">
            고객센터
          </Link>
        </nav>
      </div>
    </footer>
  );
}
