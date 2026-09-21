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
 *   error 승격은 후속 웨이브에서 규칙별로 판단한다.
 */
export default defineConfig([
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "out/**",
    "dist/**",
    "supabase/migrations/**",
  ]),

  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
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

      // ── Next 16 / eslint-config-next 16 전환으로 **새로 생긴** 규칙들 ──
      // 기본 severity 가 error 라 전환 자체를 막는다. 이번 웨이브는 동작 변경을 하지 않는
      // 것이 방침이므로 warn 으로 낮춰 가시화만 하고, 실제 수정과 error 승격은 후속 웨이브에서
      // 규칙별로 처리한다.
      //
      // eslint-plugin-react-hooks 7 (React Compiler 기반 신규 규칙):
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      // typescript-eslint 8 신규 규칙(구 ban-types 분리):
      "@typescript-eslint/no-empty-object-type": "warn",
    },
  },
]);
