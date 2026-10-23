import { Suspense } from "react";
import { InboxPage } from "./inbox-page";

export const metadata = { title: "Inbox · ShiftPilot" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InboxPage />
    </Suspense>
  );
}
