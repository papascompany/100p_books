#!/usr/bin/env python3
"""
Pretendard 가변 폰트 서브셋 생성 — public/fonts/Pretendard-{ui,kr,ext}.woff2.

    python3 scripts/build-font-subsets.py

배경 (2026-08-07 재측정):
    운영 홈의 총 전송량 938KB 중 폰트 하나가 533KB(57%)였다. Lighthouse 는 Lantern
    시뮬레이션(mobile 1,474Kbps)으로 LCP 를 재계산하므로 938KB ÷ 184KB/s ≈ 5.1s 가
    그대로 LCP 가 된다 — 즉 이 페이지의 LCP 는 렌더가 아니라 **대역폭**이 정한다.
    TBT 는 0 이고 LCP 이미지(51KB)는 fetchpriority/eager/discoverable 진단을 모두
    통과한 상태라, 남은 레버는 폰트뿐이었다.

3단 분할 (2단 → 3단으로 변경):
    ui   = 라틴·기호·가나 + **앱 소스에 실제로 등장하는 한글**  → preload (크리티컬)
    kr   = KS X 1001 2,350자 중 ui 에 없는 나머지               → preload 안 함
    ext  = 완성형 11,172자 중 위 둘에 없는 나머지                → preload 안 함

    왜 "앱 소스에 등장하는 한글" 인가:
      UI 문자열은 코드에 리터럴로 박혀 있어 정적으로 전부 수집할 수 있다. 실측 760자로
      KS X 1001 전체(2,350자)의 1/3 이며, 이 집합만으로 앱의 모든 고정 문구가 커버된다.
      사용자 생성 텍스트(프로젝트 제목·후기·주소)에서만 kr/ext 를 추가로 받는다.

    이전 시도와의 차이: 2026-08-05 에 "core 를 preload:false 로" 바꿨다가 FCP 가
    959→3,619ms 로 악화해 되돌린 적이 있다. 이번은 preload 를 **유지하고 크기를 줄인다**.

    KS X 1001 판정은 iso2022_kr 인코딩 가능 여부로 한다.
    (euc_kr / johab 은 CP949 확장을 포함해 11,172자 전부를 통과시켜 분할에 못 쓴다.)

⚠️ ui 서브셋은 **소스 코드 스캔 결과에 의존**한다. 새 한글 문구를 많이 추가한 뒤에는
   이 스크립트를 다시 돌려야 그 글자가 크리티컬 서브셋에 들어간다. 돌리지 않아도
   폴백 체인 덕에 깨지지는 않는다 — kr 서브셋에서 받아올 뿐이다.

산출물은 커밋된다 — 이 스크립트는 재생성·검증용이며 빌드/CI 파이프라인에는 없다.
fontTools 필요: pip install fonttools brotli
"""

import os
import pathlib
import subprocess
import sys

SRC = "assets/fonts/PretendardVariable.woff2"
OUT_UI = "public/fonts/Pretendard-ui.woff2"
OUT_KR = "public/fonts/Pretendard-kr.woff2"
OUT_EXT = "public/fonts/Pretendard-ext.woff2"

# UI 문자열을 담고 있는 소스 트리 (+ 시드 데이터가 든 마이그레이션).
SCAN_DIRS = ["app", "components", "lib", "hooks"]
SCAN_SUFFIXES = {".ts", ".tsx"}
SCAN_EXTRA = [("supabase/migrations", {".sql"})]

# 한글 외 문자 범위.
#
# 2026-08-07 에 블록별 실사용을 세어 범위를 좁혔다(전체 1,864자 중 실사용 124자).
# 사용 0 으로 확인돼 **뺀** 블록: 라틴 확장(U+0100-024F) · 문자 유사(U+2100-214F) ·
# 도형(U+25A0-25FF) · 가나(U+3040-30FF) · 전각(U+FF00-FFEF).
# 수학·기타 기호는 블록 통째(각 256자) 대신 실제로 쓰는 글자만 개별 지정한다.
#
# 반대로 소스에 안 나와도 **남긴** 것들과 이유:
#   U+20A0-20BF 통화  — 금액 표기가 `${KRW.format(n)}원` 이라 지금은 ₩ 를 쓰지 않지만,
#                       포맷을 currency 로 바꾸면 즉시 필요해진다(32자로 저렴).
#   U+3130-318F 자모  — 사용자 입력에 "ㅋㅋ/ㅎㅎ" 가 흔하다(프로젝트 제목·후기).
#   U+00A0-00FF, U+2000-206F, U+2190-21FF — 실사용이 있고 블록이 작다.
#
# 여기서 뺀 문자는 사라지는 게 아니라 시스템 폰트로 폴백된다(kr/ext 는 한글만 담는다).
COMMON_RANGES = ",".join(
    [
        "U+0020-007E",  # ASCII (95/95 사용)
        "U+00A0-00FF",  # 라틴-1 보충 — § © ° ± ² · ×
        "U+2000-206F",  # 일반 구두점 — – — ― • …
        "U+20A0-20BF",  # 통화 기호 (예비)
        "U+2190-21FF",  # 화살표 — ← ↑ → ↓ ↔
        "U+3000-303F",  # CJK 기호 — 「」및 전각 공백
        "U+3130-318F",  # 한글 자모 — 사용자 입력 대비
        # 수학 연산자 실사용분: ∈ ∞ ≈ ≠ ≤ ≥ ⋯
        "U+2208,U+221E,U+2248,U+2260,U+2264,U+2265,U+22EF",
        # 기타 기호 실사용분: ★ ⚠ ⚡
        "U+2605,U+26A0,U+26A1",
    ]
)


def in_ks_x_1001(ch: str) -> bool:
    try:
        ch.encode("iso2022_kr")
        return True
    except Exception:
        return False


def scan_ui_hangul() -> set[int]:
    """소스에 리터럴로 등장하는 한글 완성형 음절을 모은다."""
    found: set[int] = set()
    targets: list[tuple[str, set[str]]] = [(d, SCAN_SUFFIXES) for d in SCAN_DIRS]
    targets += SCAN_EXTRA
    for root, suffixes in targets:
        base = pathlib.Path(root)
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.suffix not in suffixes:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            for ch in text:
                code = ord(ch)
                if 0xAC00 <= code <= 0xD7A3:
                    found.add(code)
    return found


def main() -> int:
    if not os.path.exists(SRC):
        print(f"원본 폰트를 찾을 수 없습니다: {SRC}", file=sys.stderr)
        return 1

    syllables = list(range(0xAC00, 0xD7A4))  # 한글 완성형 11,172자
    ui_hangul = scan_ui_hangul()
    ks = {c for c in syllables if in_ks_x_1001(chr(c))}
    kr_hangul = ks - ui_hangul
    ext_hangul = [c for c in syllables if c not in ui_hangul and c not in kr_hangul]

    print(
        f"ui 한글 {len(ui_hangul)}자 / kr 한글 {len(kr_hangul)}자 / ext 한글 {len(ext_hangul)}자"
    )

    def fmt(codes) -> str:
        return ",".join(f"U+{c:04X}" for c in sorted(codes))

    jobs = [
        (OUT_UI, f"{COMMON_RANGES},{fmt(ui_hangul)}"),
        (OUT_KR, fmt(kr_hangul)),
        (OUT_EXT, fmt(ext_hangul)),
    ]
    total = 0
    for out, unicodes in jobs:
        subprocess.run(
            [
                "pyftsubset",
                SRC,
                f"--unicodes={unicodes}",
                "--flavor=woff2",
                "--layout-features=*",
                f"--output-file={out}",
            ],
            check=True,
        )
        size = os.path.getsize(out)
        total += size
        print(f"  {out}: {size / 1024:.0f} KB")

    print(f"  합계 {total / 1024:.0f} KB (원본 {os.path.getsize(SRC) / 1024:.0f} KB)")
    print(f"  크리티컬 경로에 올라가는 것은 {os.path.getsize(OUT_UI) / 1024:.0f} KB 뿐이다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
