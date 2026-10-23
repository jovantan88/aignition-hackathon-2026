import { Suspense } from "react";
import { RunRoute } from "./run-route";

export const metadata = { title: "Agent run · ShiftPilot" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RunRoute />
    </Suspense>
  );
}
