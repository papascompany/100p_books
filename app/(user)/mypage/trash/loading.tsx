export default function TrashLoading() {
  return (
    <div className="container py-6 md:py-10 animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-8 w-28 bg-hairline" />
        <div className="h-3 w-60 bg-hairline" />
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="aspect-square bg-hairline" />
        ))}
      </div>
    </div>
  );
}
