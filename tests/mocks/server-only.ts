// vitest 환경 전용 server-only stub.
// 운영 빌드에서는 next/webpack 이 server-only 패키지를 클라이언트 그래프에서 차단하지만,
// vitest 는 RSC 그래프를 모르므로 import 시 throw 된다 → 빈 모듈로 대체.
export {};
