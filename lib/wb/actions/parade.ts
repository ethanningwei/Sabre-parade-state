"use server";

import { run } from "@/lib/actions/shared";
import { requireFeature } from "@/lib/flags";
import { actionMember } from "@/lib/wb/auth";
import { signInToParadeState } from "@/lib/wb/parade-link";

/** The Mini App's "Parade state": signs them in to the v1 web app; the client then loads "/". */
export async function openParadeState() {
  requireFeature();
  return run(async () => signInToParadeState(await actionMember()));
}
