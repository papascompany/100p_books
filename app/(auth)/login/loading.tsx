export default function LoginLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f5] animate-pulse">
      <div className="w-full max-w-md space-y-6 px-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto h-8 w-48 bg-[#e5e5e5]" />
          <div className="mx-auto h-3 w-72 bg-[#e5e5e5]" />
        </div>
        <div className="rounded-2xl border border-[#e5e5e5] bg-white p-6 space-y-4">
          <div className="h-4 w-12 bg-[#e5e5e5]" />
          <div className="h-11 w-full bg-[#e5e5e5]" />
          <div className="flex items-center gap-2">
            <div className="size-4 bg-[#e5e5e5]" />
            <div className="h-3 w-56 bg-[#e5e5e5]" />
          </div>
          <div className="h-11 w-full bg-[#e5e5e5]" />
          <div className="h-9 w-full bg-[#e5e5e5]" />
        </div>
      </div>
    </div>
  );
}
