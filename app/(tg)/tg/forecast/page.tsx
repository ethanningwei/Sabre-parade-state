import { redirect } from "next/navigation";
import { requireFeaturePage } from "@/lib/flags";

// The forecast is Manpower's 14-day view now (2026-10-16). Kept so old links still land.
export default async function ForecastPage() {
  await requireFeaturePage();
  redirect("/tg/manpower?view=grid");
}
