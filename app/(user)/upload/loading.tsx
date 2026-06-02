export default function UploadLoading() {
  return (
    <div className="container max-w-3xl py-8 animate-pulse">
      <div className="mb-6 text-center space-y-2">
        <div className="mx-auto h-3 w-20 bg-hairline" />
        <div className="mx-auto h-8 w-44 bg-hairline" />
        <div className="mx-auto h-4 w-64 bg-hairline" />
      </div>
      {/* 드롭존 스켈레톤 */}
      <div className="flex h-56 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-hairline bg-soft-cloud">
        <div className="size-14 rounded-full bg-hairline" />
        <div className="space-y-2 text-center">
          <div className="mx-auto h-5 w-48 bg-hairline" />
          <div className="mx-auto h-4 w-36 bg-hairline" />
        </div>
      </div>
    </div>
  );
}
