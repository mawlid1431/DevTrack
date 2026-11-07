"use client";

import { useParams } from "next/navigation";
import { RecycleBin } from "@/components/trash/recycle-bin";

/** Recycle bin: restore or permanently delete items (30-day retention). */
export default function Page() {
  const params = useParams<{ orgSlug: string }>();
  return <RecycleBin orgSlug={params.orgSlug} />;
}
