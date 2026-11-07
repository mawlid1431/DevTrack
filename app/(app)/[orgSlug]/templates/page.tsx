"use client";

import { useParams } from "next/navigation";
import { TemplatesPage } from "@/components/templates/templates-page";

/** Project and workspace templates (built-in + this workspace's custom ones). */
export default function Page() {
  const params = useParams<{ orgSlug: string }>();
  return <TemplatesPage orgSlug={params.orgSlug} />;
}
