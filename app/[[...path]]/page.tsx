import { Suspense } from "react";
import { AvielleApp } from "@/components/avielle-app";

export default function Page() {
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
