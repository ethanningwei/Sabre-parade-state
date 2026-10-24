import "server-only";
import { redirect } from "next/navigation";
import { requireFeaturePage } from "@/lib/flags";
import { requireRegistered } from "@/lib/wb/auth";
import { runsChangeover } from "@/lib/wb/changeover-data";

/** For the changeover's pages: COY HQ and admins only; anyone else goes Home. */
export async function requireChangeoverPage() {
  await requireFeaturePage();
  const m = await requireRegistered();
  if (!(await runsChangeover(m))) redirect("/tg");
  return m;
}
