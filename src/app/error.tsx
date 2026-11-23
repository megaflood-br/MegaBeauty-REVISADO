"use client";

import { RouteErrorView } from "@/components/route-error-view";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorView error={error} reset={reset} />;
}
