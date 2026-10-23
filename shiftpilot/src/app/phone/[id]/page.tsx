import { Suspense } from "react";
import { PhoneRoute } from "./phone-route";

export const metadata = { title: "Phone · ShiftPilot" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PhoneRoute />
    </Suspense>
  );
}
