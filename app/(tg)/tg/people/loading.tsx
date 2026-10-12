import { Bone, Group } from "@/components/tg/ui";

// A list of people loading. Static: no data.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2 px-1">
        <Bone className="h-7 w-40" />
        <Bone className="h-4 w-56" />
      </div>
      <Bone className="h-12 rounded-xl" />
      <Group rows>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex min-h-13 flex-col justify-center gap-1.5 px-4">
            <Bone className="h-4 w-36" />
            <Bone className="h-3 w-24" />
          </div>
        ))}
      </Group>
    </div>
  );
}
