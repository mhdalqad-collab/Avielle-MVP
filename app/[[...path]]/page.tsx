import { Suspense } from "react";
import { AvielleApp } from "@/components/avielle-app";

export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const route = await params;
  // The public home illustration is useful without hydration. Wait for its
  // initial markup rather than streaming it into a hidden Suspense segment.
  if (!route.path?.length) return <AvielleApp />;
  return (
    <Suspense
      fallback={
        <div className="page-loading" role="status">
          Opening Avielle…
        </div>
      }
    >
      <AvielleApp />
    </Suspense>
  );
}
