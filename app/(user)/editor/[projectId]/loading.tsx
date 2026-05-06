export default function EditorLoading() {
  return (
    <div className="flex h-[calc(100dvh-4rem)] animate-pulse flex-col">
      {/* 에디터 탑바 */}
      <div className="flex h-14 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded bg-muted" />
          <div className="h-5 w-32 rounded bg-muted" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-20 rounded bg-muted" />
          <div className="h-8 w-20 rounded bg-muted" />
        </div>
      </div>
      {/* 페이지 그리드 */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[3/4] rounded-xl border bg-muted"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
