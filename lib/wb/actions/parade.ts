"use server";

import { run } from "@/lib/actions/shared";
import { requireFeature } from "@/lib/flags";
import { actionMember } from "@/lib/wb/auth";
import { paradeStatePath } from "@/lib/wb/domain/parade-links";
import { signInToParadeState } from "@/lib/wb/parade-link";

/** The Mini App's "Parade state": signs them in to the v1 web app; the client then loads `path` (a v1 screen, else "/"). */
export async function openParadeState(to?: string) {
  requireFeature();
  return run(async () => ({ ...(await signInToParadeState(await actionMember())), path: paradeStatePath(to) }));
}
