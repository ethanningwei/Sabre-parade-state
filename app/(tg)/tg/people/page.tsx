import { Header } from "@/components/tg/form-bits";
import { PeopleList } from "@/components/tg/people-list";
import { requireFeaturePage } from "@/lib/flags";
import { requireScreenPage } from "@/lib/wb/auth";
import { peopleInScope } from "@/lib/wb/records";

// Whose history to open: the platoon for its PC/PS, everyone for OC/2IC/CSM.
export default async function PeoplePage() {
  await requireFeaturePage();
  const member = await requireScreenPage("people");
  const people = await peopleInScope(member.grants, "decide");
  return (
    <div className="flex flex-col gap-4">
      <Header title="Person history" hint="Everything on someone's timeline. Void a mistake from there." />
      <PeopleList people={people} />
    </div>
  );
}
