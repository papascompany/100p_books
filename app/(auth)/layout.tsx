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
          className="font-campaign text-xl text-[#111111]"
          aria-label="홈으로"
        >
          100P BOOKS
        </Link>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        {children}
      </div>
    </main>
  );
}
