export default function UploadLoading() {
  return (
    <div className="container max-w-3xl py-8 animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-8 w-40 rounded-lg bg-muted" />
        <div className="h-4 w-64 rounded bg-muted" />
      </div>
      {/* 드롭존 스켈레톤 */}
      <div className="flex h-56 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-muted bg-muted/20">
        <div className="size-12 rounded-full bg-muted" />
        <div className="space-y-2 text-center">
          <div className="mx-auto h-5 w-48 rounded bg-muted" />
          <div className="mx-auto h-4 w-36 rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
