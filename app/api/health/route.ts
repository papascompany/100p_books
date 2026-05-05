import { ok } from "@/app/api/_lib/response";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok({
    service: "100p_books",
    status: "healthy",
    now: new Date().toISOString(),
  });
}
