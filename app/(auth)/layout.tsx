import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col bg-hero-gradient">
      <header className="container flex h-16 items-center">
        <Link
          href="/"
          className="font-display text-xl font-semibold tracking-tight"
          aria-label="홈으로"
        >
          100p <span className="text-rose-500">Books</span>
        </Link>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        {children}
      </div>
    </main>
  );
}
