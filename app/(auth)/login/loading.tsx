export default function LoginLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-soft-cloud animate-pulse">
      <div className="w-full max-w-md space-y-6 px-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto h-8 w-48 bg-hairline" />
          <div className="mx-auto h-3 w-72 bg-hairline" />
        </div>
        <div className="rounded-2xl border border-hairline bg-card p-6 space-y-4">
          <div className="h-4 w-12 bg-hairline" />
          <div className="h-11 w-full bg-hairline" />
          <div className="flex items-center gap-2">
            <div className="size-4 bg-hairline" />
            <div className="h-3 w-56 bg-hairline" />
          </div>
          <div className="h-11 w-full bg-hairline" />
          <div className="h-9 w-full bg-hairline" />
        </div>
      </div>
    </div>
  );
}
