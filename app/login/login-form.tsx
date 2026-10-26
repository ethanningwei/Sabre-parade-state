"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type LoginState } from "@/lib/actions/auth";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: null, name: "" });

  return (
    <form action={action} className="flex w-full max-w-xs flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Your rank and name</Label>
        <Input
          // remount to show the name echoed back after a failed attempt
          key={state.name}
          id="name"
          name="name"
          defaultValue={state.name}
          placeholder="3SG TAN"
          autoComplete="name"
          autoCapitalize="characters"
          required
          className="h-12 rounded-xl bg-card text-base uppercase dark:bg-card"
        />
        <p className="text-xs text-muted-foreground">Shown against every change you make.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-12 rounded-xl bg-card text-base dark:bg-card"
        />
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-issue/10 px-3 py-2 text-sm text-issue">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="h-12 text-base" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Sign in
      </Button>
    </form>
  );
}
