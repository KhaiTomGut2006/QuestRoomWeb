"use client";

import { SessionProvider } from "next-auth/react";
import { withBasePath } from "@/lib/basePath";

export default function Providers({ children }) {
  return <SessionProvider basePath={withBasePath("/api/auth")}>{children}</SessionProvider>;
}
