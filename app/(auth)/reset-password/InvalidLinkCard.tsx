import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** 재설정 링크 없이 /reset-password 에 도달했을 때의 안내. */
export default function InvalidLinkCard() {
  return (
    <Card className="w-full max-w-md rounded-2xl shadow-soft">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-semibold tracking-tight">
          링크가 유효하지 않아요
        </CardTitle>
        <CardDescription className="mt-2">
          비밀번호는 메일로 받은 재설정 링크로만 변경할 수 있어요. 링크가
          만료되었거나 잘못된 접근입니다. 다시 요청해 주세요.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild size="lg" variant="coral" className="w-full">
          <Link href="/login?mode=forgot">비밀번호 찾기 다시 하기</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
