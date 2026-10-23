import { Suspense } from "react";
import { ProfilePage } from "./profile-page";

export const metadata = { title: "Profile · ShiftPilot" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ProfilePage />
    </Suspense>
  );
}
