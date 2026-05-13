// tsx 로 server 코드를 직접 실행할 때 server-only 패키지 throw 를 우회한다.
// 실제 운영 빌드(next/webpack RSC graph)에는 영향이 없으며, 검증 스크립트 한정.
//
// 사용:
//   NODE_OPTIONS="--require ./scripts/_server-only-stub.cjs" tsx scripts/verify-pdf.ts
const Module = require("node:module");
const orig = Module._resolveFilename;
Module._resolveFilename = function patched(request, parent, ...rest) {
  if (request === "server-only") {
    return require.resolve("./_empty.cjs", { paths: [__dirname] });
  }
  return orig.call(this, request, parent, ...rest);
};
