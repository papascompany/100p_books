import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col bg-[#f5f5f5]">
      <header className="container flex h-14 items-center border-b border-[#cacacb] bg-white">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-[#111111]"
          aria-label="홈으로"
        >
          <span className="font-display-num text-2xl font-bold leading-none">100p</span>
          <span className="text-base font-semibold tracking-tight">Books</span>
        </Link>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        {children}
      </div>
    </main>
  );
}
