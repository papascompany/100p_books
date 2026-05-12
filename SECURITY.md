# 보안 패치 이력 및 관리 가이드

> 프로젝트 보안 취약점 대응 기록. 신규 이슈 발견 시 이 파일을 업데이트한다.

---

## 적용된 패치 이력

### 2026-05-10 — Next.js 14.2.15 → 14.2.35

| 심각도 | CVE / 어드바이저리 | 내용 | 패치 버전 |
|---|---|---|---|
| 🔴 CRITICAL | GHSA-3h6h-... | Middleware Authorization Bypass — `/admin` 등 보호 경로 우회 가능 | 14.2.25+ |
| 🟠 HIGH | GHSA-... | Server Components DoS | 14.2.34+ |
| 🟠 HIGH | GHSA-... | HTTP 역직렬화 DoS | 14.2.35+ |

**영향 프로젝트**: `100p_books` (14.2.15 → 14.2.35), `mystory` (14.2.15 → 14.2.35)

검증 결과 (`100p_books`):
- `pnpm typecheck` ✅ 오류 0
- `pnpm test` ✅ 153/153 통과
- `pnpm build` ✅ 31페이지 성공
- Vercel 배포 ✅ https://100pbooks.vercel.app

---

## 잔존 취약점 (향후 처리)

### Next.js 15.x/16.x 업그레이드 필요 이슈

아래 항목들은 Next.js 14.x 범위에서 패치할 수 없으며, 15.x 또는 16.x 메이저 업그레이드가 필요하다.
**현재 서비스에서 직접 악용 가능성은 낮으나** 중장기적으로 마이그레이션 계획 수립 권고.

| 심각도 | 내용 | 완전 패치 버전 |
|---|---|---|
| 🟠 HIGH | Next.js DoS — Image Optimizer remotePatterns | 15.x |
| 🟠 HIGH | Next.js HTTP request smuggling (rewrites) | 15.x |
| 🟠 HIGH | Next.js SSRF via WebSocket upgrades | 15.5.16+ |
| 🟡 MEDIUM | Next.js cache poisoning (RSC) | 15.5.16+ |
| 🟡 MEDIUM | Middleware/Proxy redirect cache-poisoning | 15.5.16+ |
| 🟡 MEDIUM | postcss <8.5.10 XSS (Next 내부 의존) | 16.x 내장 해결 |

### Fabric.js 6.x → 7.x (현재 앱에서 미해당)

- CVE: Stored XSS via SVG Export (`<7.2.0`)
- **현재 앱 상황**: 사용자가 SVG를 Fabric에 직접 로드하는 경로 없음 → **직접 노출 없음**
- Fabric 7.x는 API 변경이 크므로 별도 에디터 마이그레이션 마일스톤으로 처리

---

## 정기 점검 절차

```bash
# 100p_books
cd /Users/yohan/Documents/claude/100p_books
pnpm audit

# mystory
cd /Users/yohan/Documents/claude/mystory
npm audit
```

### 판단 기준

| 심각도 | 대응 기한 |
|---|---|
| CRITICAL | 즉시 (24시간 내) |
| HIGH | 1주일 내 |
| MODERATE | 다음 배포 사이클에 포함 |
| LOW | 분기별 점검 시 처리 |

---

## 환경변수 보안 체크리스트

배포 전 반드시 확인:

- [ ] `.env.local` 가 `.gitignore`에 포함되어 있음
- [ ] `SUPABASE_SERVICE_ROLE_KEY` 가 서버 코드에서만 사용됨 (`"use client"` 파일에 없음)
- [ ] `NEXT_PUBLIC_` prefix 변수에 시크릿 없음 (anon key, 공개 client key만 허용)
- [ ] `TOSS_SECRET_KEY` 가 API Route 전용임
- [ ] `RESEND_API_KEY` 가 server-only 모듈에서만 사용됨

---

## 관련 리소스

- [Next.js Security Advisories](https://github.com/vercel/next.js/security/advisories)
- [Supabase Security Best Practices](https://supabase.com/docs/guides/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
