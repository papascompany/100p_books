"use client";

import dynamic from "next/dynamic";
import { forwardRef } from "react";

import type { FabricStageHandle, FabricStageProps } from "./FabricStage";

/**
 * `FabricStage` 의 lazy 로딩 래퍼 — **ref 가 살아 있는** 버전.
 *
 * 왜 필요한가 (2026-08-07 회귀 수정):
 *   `46e8d4e` 에서 fabric.js 를 초기 번들에서 떼어내려고 에디터들이 FabricStage 를
 *   `dynamic(() => import(...))` 로 직접 감쌌다. 그런데 next/dynamic 이 만드는 Loadable
 *   래퍼는 함수 컴포넌트라 **ref 를 전달하지 않는다** — React 가
 *   "Function components cannot be given refs" 로 경고하고 ref 는 버려진다.
 *   그 결과 `stageRef.current` 가 계속 null 이었고, 표지/내지 에디터의 저장·텍스트 추가·
 *   사진 추가·undo/redo 가 **전부 조용히 no-op** 이 됐다(dev·프로덕션 빌드 모두 재현).
 *   특히 표지 저장이 안 되면 `cover_json` 이 없어 주문 단계 자체가 열리지 않는다.
 *
 * 해법: ref 를 prop(`forwardedRef`)으로 우회시킨다. 이 래퍼가 forwardRef 로 ref 를 받아
 *   Loadable 에 **일반 prop 으로** 넘기고, FabricStage 가 그것을 useImperativeHandle 에
 *   연결한다. lazy 청크 분리(성능 이득)는 그대로 유지된다.
 *
 * 새 코드는 FabricStage 를 직접 dynamic() 으로 감싸지 말고 이 컴포넌트를 쓸 것.
 */
const FabricStageInner = dynamic(() => import("./FabricStage"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-64 w-full flex-1 items-center justify-center bg-soft-cloud">
      <div className="size-10 animate-spin rounded-full border-4 border-hairline border-t-ink" />
    </div>
  ),
});

const FabricStageLazy = forwardRef<
  FabricStageHandle,
  Omit<FabricStageProps, "forwardedRef">
>(function FabricStageLazy(props, ref) {
  return <FabricStageInner {...props} forwardedRef={ref} />;
});

export default FabricStageLazy;
