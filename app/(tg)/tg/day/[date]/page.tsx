import { redirect } from "next/navigation";
import { requireFeaturePage } from "@/lib/flags";

// One day is Manpower's day view now (2026-10-16). Kept so old links still land.
export default async function DayPage({ params, searchParams }: { params: Promise<{ date: string }>; searchParams: Promise<{ camp?: string | string[] }> }) {
  await requireFeaturePage();
  const { date } = await params;
  const camp = (await searchParams).camp;
  const q = new URLSearchParams({ date });
  if (typeof camp === "string") q.set("camp", camp);
  redirect(`/tg/manpower?${q}`);
}
