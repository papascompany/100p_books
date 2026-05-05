import type { Metadata } from "next";
import { Suspense } from "react";

import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "로그인",
  description: "이메일 매직링크로 간편하게 로그인하세요.",
};

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
