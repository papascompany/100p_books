import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 다이얼로그 중앙 정렬 회귀 가드.
 *
 * 배경: DialogContent 는 `left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2` 로 중앙에
 * 놓이는데, 여기에 `animate-fade-in`(fill-mode `both`, 마지막 프레임 `translateY(0)`)을
 * 함께 걸면 애니메이션이 끝난 뒤에도 유틸리티 transform 이 **영구히 덮여** 다이얼로그가
 * 중앙에서 밀린다. 실측에서 모바일 "영구 삭제" 버튼이 화면 밖으로, 1280×800 탈퇴
 * 다이얼로그의 "취소/탈퇴하기"가 뷰포트 아래로 잘려 조작 자체가 불가능했다.
 *
 * 새 다이얼로그를 만들 때 같은 실수가 반복되기 쉬워 소스 수준에서 막는다.
 */

const ROOTS = ["components", "app"];
/** transform 을 끝 프레임까지 덮어쓰는(=fill-mode both) 공용 애니메이션. */
const TRANSFORM_RESETTING = [
  "animate-fade-in",
  "animate-fade-up",
  "animate-scale-in",
];

/** 주석에 클래스명을 언급한 문서/경고까지 위반으로 잡지 않도록 제거한다. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

function collectTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      collectTsx(full, out);
    } else if (entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/** open 위치의 `{` 부터 짝이 맞는 `}` 까지를 잘라낸다. */
function braceBlock(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error("닫히지 않은 블록");
}

describe("다이얼로그 중앙 정렬", () => {
  it("중앙 정렬 transform 을 쓰는 컴포넌트는 transform 을 덮는 공용 애니메이션을 쓰지 않는다", () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of collectTsx(root)) {
        const src = stripComments(readFileSync(file, "utf8"));
        if (!src.includes("-translate-x-1/2")) continue;
        const used = TRANSFORM_RESETTING.filter((cls) =>
          // 클래스 경계까지 확인 — animate-fade-in 이 animate-fade-in-foo 를 오탐하지 않게.
          new RegExp(`${cls}(?![\\w-])`).test(src),
        );
        if (used.length > 0) {
          offenders.push(`${file} → ${used.join(", ")}`);
        }
      }
    }

    expect(
      offenders,
      offenders.length > 0
        ? `중앙 정렬(-translate-x-1/2)과 transform 을 덮는 애니메이션을 같이 쓰면 ` +
            `다이얼로그가 화면 밖으로 밀린다. animate-dialog-in / animate-dialog-out 을 쓰세요.\n` +
            offenders.map((o) => `  - ${o}`).join("\n")
        : "",
    ).toEqual([]);
  });

  it("dialog-in / dialog-out 키프레임은 양 끝 프레임 모두 중앙 정렬을 유지한다", () => {
    const cfg = readFileSync("tailwind.config.ts", "utf8");
    for (const name of ["dialog-in", "dialog-out"]) {
      const start = cfg.indexOf(`"${name}": {`);
      expect(start, `${name} 키프레임이 없습니다`).toBeGreaterThan(-1);
      const block = braceBlock(cfg, cfg.indexOf("{", start));
      // from/to 두 프레임 모두에 translate(-50%, -50%) 가 있어야 유틸리티 정렬이 보존된다.
      const matches = block.match(/translate\(-50%,\s*-50%\)/g) ?? [];
      expect(matches.length, `${name} 프레임에 중앙 정렬 누락`).toBe(2);
    }
  });
});
