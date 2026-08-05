#!/usr/bin/env python3
"""
Pretendard 가변 폰트 서브셋 생성 — public/fonts/Pretendard-{core,ext}.woff2.

    python3 scripts/build-font-subsets.py

배경:
    PretendardVariable.woff2 는 2,009KB 이고 전체 전송량의 82% 를 차지한다.
    운영 Lighthouse 실측에서 TBT 는 80ms 로 낮은데 TTI 가 12.4s 였던 이유가 이것 —
    JS 실행이 아니라 이 폰트가 네트워크를 오래 점유했다.

분할 기준:
    core = 라틴·기호·가나 + KS X 1001 한글 2,350자   → 533KB (초기 로드)
    ext  = 나머지 완성형 한글 8,822자                 → 1,317KB (해당 글자가 실제로
           쓰일 때만 브라우저가 요청 — font-family 폴백 체인으로 연결)

    KS X 1001 집합은 iso2022_kr 인코딩 가능 여부로 판정한다.
    (euc_kr / johab 은 CP949 확장을 포함해 11,172자 전부를 받아들이므로 분할에 못 쓴다.)

산출물은 커밋된다 — 이 스크립트는 재생성·검증용이며 빌드/CI 파이프라인에는 없다.
fontTools 필요: pip install fonttools brotli
"""

import os
import subprocess
import sys

SRC = "assets/fonts/PretendardVariable.woff2"
OUT_CORE = "public/fonts/Pretendard-core.woff2"
OUT_EXT = "public/fonts/Pretendard-ext.woff2"

# 라틴, 라틴 확장, 구두점, 통화, 기호, 화살표, 수학, 도형, CJK 기호, 가나, 한글 자모, 전각
COMMON_RANGES = ",".join(
    [
        "U+0020-007E",
        "U+00A0-00FF",
        "U+0100-024F",
        "U+2000-206F",
        "U+20A0-20BF",
        "U+2100-214F",
        "U+2190-21FF",
        "U+2200-22FF",
        "U+25A0-25FF",
        "U+2600-26FF",
        "U+3000-303F",
        "U+3040-30FF",
        "U+3130-318F",
        "U+FF00-FFEF",
    ]
)


def in_ks_x_1001(ch: str) -> bool:
    try:
        ch.encode("iso2022_kr")
        return True
    except Exception:
        return False


def main() -> int:
    if not os.path.exists(SRC):
        print(f"원본 폰트를 찾을 수 없습니다: {SRC}", file=sys.stderr)
        return 1

    syllables = range(0xAC00, 0xD7A4)  # 한글 완성형 11,172자
    core_hangul = [c for c in syllables if in_ks_x_1001(chr(c))]
    ext_hangul = [c for c in syllables if not in_ks_x_1001(chr(c))]
    print(f"core 한글 {len(core_hangul)}자 / ext 한글 {len(ext_hangul)}자")

    def fmt(codes):
        return ",".join(f"U+{c:04X}" for c in codes)

    jobs = [
        (OUT_CORE, f"{COMMON_RANGES},{fmt(core_hangul)}"),
        (OUT_EXT, fmt(ext_hangul)),
    ]
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
        print(f"  {out}: {os.path.getsize(out) / 1024:.0f} KB")

    print(f"  (원본 {os.path.getsize(SRC) / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
