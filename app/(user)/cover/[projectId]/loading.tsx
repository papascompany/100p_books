export default function CoverLoading() {
  return (
    <div className="flex h-screen flex-col animate-pulse">
      <div className="flex items-center justify-between border-b border-hairline bg-background px-4 py-3">
        <div className="h-5 w-32 bg-hairline rounded" />
        <div className="flex gap-2">
          <div className="h-9 w-20 bg-hairline rounded-full" />
          <div className="h-9 w-24 bg-hairline rounded-full" />
        </div>
      </div>
      <div className="flex flex-1">
        <div className="flex-1 bg-soft-cloud" />
        <div className="w-72 border-l border-hairline bg-background p-4 space-y-3">
          <div className="h-4 w-24 bg-hairline rounded" />
          <div className="h-32 w-full bg-hairline rounded-xl" />
          <div className="h-4 w-24 bg-hairline rounded" />
          <div className="h-32 w-full bg-hairline rounded-xl" />
        </div>
      </div>
    </div>
  );
}
