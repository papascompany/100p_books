import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

/**
 * ESLint flat config (Next 16 전환).
 *
 * - Next 16 은 `next lint` 를 제거했다. 검사는 `pnpm lint` → `eslint` CLI 가 직접 수행하고,
 *   검사 대상 디렉터리는 package.json 의 lint 스크립트에서 지정한다.
 * - 예전 `.eslintrc.json` 의 `extends: ["next/core-web-vitals", "plugin:@typescript-eslint/recommended"]`
 *   는 eslint-config-next 16 이 내장한 flat 프리셋 두 개로 대체한다
 *   (`core-web-vitals` = next + react + react-hooks 7 + jsx-a11y, `typescript` = typescript-eslint 8).
 * - 이번 웨이브의 방침: 전환으로 **새로 생기는 규칙 위반은 warn** 으로 두고 error 로 올리지 않는다.
 *   error 승격은 후속 웨이브에서 규칙별로 판단한다(react-hooks 4규칙은 승격 완료 — 아래 주석).
 */
export default defineConfig([
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "out/**",
    "dist/**",
    "supabase/migrations/**",
    // 테스트·회귀 스크립트가 만드는 산출물(번들된 JS 포함) — 소스가 아니다.
    "tmp/**",
    "test-results/**",
    "playwright-report/**",
  ]),

  ...nextCoreWebVitals,
  ...nextTypeScript,

  // CommonJS 스텁(scripts/*.cjs — vitest·tsx 용 server-only 대체)은 require 가 정상이다.
  {
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },

  // 규칙 블록은 해당 플러그인이 등록된 파일 범위와 같게 한정한다 — 범위가 없으면
  // 플러그인이 없는 .cjs 등에도 적용돼 `eslint .` 가 "could not find plugin" 으로 죽는다.
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // .eslintrc.json 에서 그대로 옮겨온 프로젝트 규칙.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // typescript-eslint 8 신규 규칙(구 ban-types 분리):
      "@typescript-eslint/no-empty-object-type": "warn",
    },
  },

  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {

      // ── Next 16 / eslint-config-next 16 전환으로 **새로 생긴** 규칙들 ──
      // 기본 severity 가 error 라 전환 자체를 막는다. 이번 웨이브는 동작 변경을 하지 않는
      // 것이 방침이므로 warn 으로 낮춰 가시화만 하고, 실제 수정과 error 승격은 후속 웨이브에서
      // 규칙별로 처리한다.
      //
      // eslint-plugin-react-hooks 7 (React Compiler 기반 신규 규칙):
      // 후속 웨이브(refactor/react-hooks-warnings)에서 위반 38건을 모두 해소해 error 로 올렸다
      // — 재발 방지. 억제가 불가피한 곳은 해당 줄에 사유를 적은 eslint-disable-next-line 만 쓴다
      // (현재 3건: CoverEditor 레이아웃 타이밍 · FileGridItem blob URL 수명 · 휴지통 서버 컴포넌트 Date.now).
      // 의도적 우회 1건(disable 주석이 아니라 grep 에 안 잡히므로 여기 명시): SelectionPanel 의
      // assignFabricProps(Object.assign 래퍼) — Fabric 외부 가변 객체 대입을 immutability 분석에서
      // 가린다. 이 예외는 Fabric 객체 한정이며, React state/props 에 같은 래퍼 패턴을 쓰지 않는다.
      // 참고: 이 규칙들은 await 경계를 보지 않고(await 뒤 setState 도 동기로 판정), catch 없는
      // try/finally 가 있는 함수는 컴파일러가 분석을 건너뛴다 — effect 에서 부르는 fetch 는
      // state 반영을 promise 콜백(.then/.catch/.finally)에 두는 패턴을 쓴다.
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/immutability": "error",
      "react-hooks/refs": "error",
      "react-hooks/purity": "error",
    },
  },
]);
