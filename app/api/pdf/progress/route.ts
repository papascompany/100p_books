import "server-only";

import { requireUser } from "@/lib/auth/session";
import { getJob, snapshot, type PdfJobSnapshot } from "@/lib/pdf/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/pdf/progress?jobId=...
 *
 * SSE — 잡 진행률을 스트리밍.
 *   - 잡이 done/failed 가 되면 마지막 이벤트 후 close.
 *   - 동일 Node 인스턴스 메모리 레지스트리에 의존 → multi-instance 환경 한계.
 *
 * 응답 헤더: text/event-stream, no-cache.
 * 이벤트: data: {"id","status","progress":{...},"result":{...}}\n\n
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response("unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) {
    return new Response("jobId required", { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return new Response("job not found", { status: 404 });
  }
  if (job.userId !== user.id) {
    return new Response("forbidden", { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (snap: PdfJobSnapshot) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(snap)}\n\n`),
          );
        } catch {
          // 스트림이 이미 닫혀있는 경우 무시
        }
      };

      // 초기 상태 즉시 push
      send(snapshot(job));
      if (job.status === "done" || job.status === "failed") {
        controller.close();
        return;
      }

      // 리스너 등록
      const listener = (snap: PdfJobSnapshot) => {
        send(snap);
        if (snap.status === "done" || snap.status === "failed") {
          job.listeners.delete(listener);
          try {
            controller.close();
          } catch {
            // ignore
          }
        }
      };
      job.listeners.add(listener);

      // 클라가 disconnect 하면 정리
      const abort = () => {
        job.listeners.delete(listener);
        try {
          controller.close();
        } catch {
          // ignore
        }
      };
      req.signal.addEventListener("abort", abort);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
