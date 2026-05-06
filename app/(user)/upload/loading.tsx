export default function UploadLoading() {
  return (
    <div className="container max-w-3xl py-8 animate-pulse">
      <div className="mb-6 text-center space-y-2">
        <div className="mx-auto h-3 w-20 bg-[#e5e5e5]" />
        <div className="mx-auto h-8 w-44 bg-[#e5e5e5]" />
        <div className="mx-auto h-4 w-64 bg-[#e5e5e5]" />
      </div>
      {/* 드롭존 스켈레톤 */}
      <div className="flex h-56 flex-col items-center justify-center gap-4 border-2 border-dashed border-[#e5e5e5] bg-[#f5f5f5]">
        <div className="size-14 rounded-full bg-[#e5e5e5]" />
        <div className="space-y-2 text-center">
          <div className="mx-auto h-5 w-48 bg-[#e5e5e5]" />
          <div className="mx-auto h-4 w-36 bg-[#e5e5e5]" />
        </div>
      </div>
    </div>
  );
}
