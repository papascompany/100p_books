export default function MypageLoading() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-10 animate-pulse">
      <div className="mb-8 space-y-2">
        <div className="h-8 w-36 bg-hairline" />
        <div className="h-4 w-52 bg-hairline" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border border-hairline bg-soft-cloud p-6 space-y-3">
            <div className="h-5 w-2/3 bg-hairline" />
            <div className="h-4 w-full bg-hairline" />
          </div>
        ))}
      </div>
    </div>
  );
}
