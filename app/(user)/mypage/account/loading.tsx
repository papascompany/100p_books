export default function AccountLoading() {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-10 animate-pulse">
      <div className="mb-6 h-8 w-32 bg-hairline" />
      <div className="space-y-4">
        <div className="rounded-2xl border border-hairline bg-soft-cloud p-5 space-y-3">
          <div className="h-4 w-24 bg-hairline" />
          <div className="h-3 w-56 bg-hairline" />
          <div className="h-3 w-44 bg-hairline" />
        </div>
        <div className="rounded-2xl border border-hairline bg-soft-cloud p-5 space-y-3">
          <div className="h-4 w-24 bg-hairline" />
          <div className="h-10 w-32 bg-hairline" />
        </div>
      </div>
    </div>
  );
}
