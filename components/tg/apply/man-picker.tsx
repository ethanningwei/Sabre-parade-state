import { Users } from "lucide-react";
import { Header } from "@/components/tg/form-bits";
import { PeopleList } from "@/components/tg/people-list";
import { EmptyState } from "@/components/tg/ui";
import type { ScopedPerson } from "@/lib/wb/records";

/** Report for your men (2026-10-24): pick the man first, then the same form as his own. */
export function ManPicker({ title, people, hrefBase }: { title: string; people: ScopedPerson[]; hrefBase: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Header title={title} hint="Pick the man. He's told, and can say it's not right." />
      {people.length ? (
        <PeopleList people={people} hrefBase={hrefBase} />
      ) : (
        <EmptyState icon={<Users />} title="Nobody to report for">
          <p>Nobody on the roster is in your reach.</p>
        </EmptyState>
      )}
    </div>
  );
}
