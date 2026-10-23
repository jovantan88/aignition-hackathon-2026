import { ManagerShell } from "@/components/control/shell";
import "./workspace.css";

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return <ManagerShell>{children}</ManagerShell>;
}
