"use client";

import { useParams } from "next/navigation";
import { RunsView } from "../runs-view";

export function RunRoute() {
  const { id } = useParams<{ id: string }>();
  return <RunsView runId={id} />;
}
