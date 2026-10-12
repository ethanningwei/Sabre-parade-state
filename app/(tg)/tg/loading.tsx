import { Bone, Group } from "@/components/tg/ui";

// Shown at once while a /tg screen loads (Home, and any screen without its
// own). Static: no data. The layout's flag check runs before this.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2 px-1">
        <Bone className="h-4 w-24" />
        <Bone className="h-7 w-44" />
        <Bone className="h-4 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Bone className="h-26 rounded-2xl" />
        <Bone className="h-26 rounded-2xl" />
      </div>
      <Group rows>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex min-h-14 items-center gap-3 px-4">
            <Bone className="size-8 rounded-lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Bone className="h-4 w-32" />
              <Bone className="h-3 w-48" />
            </div>
          </div>
        ))}
      </Group>
    </div>
  );
}
