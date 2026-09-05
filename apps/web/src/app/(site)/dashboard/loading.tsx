import { Bar } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <span className="sr-only" role="status">
        Loading
      </span>
      <div aria-hidden>
        <Bar w={130} h={26} className="rounded-full" />
        <Bar w="40%" h={38} className="mt-5" />
        <Bar w="55%" h={16} className="mt-4" />
        <div className="mt-8 flex justify-end gap-2">
          <Bar w={104} h={40} className="rounded-full" />
          <Bar w={112} h={40} className="rounded-full" />
        </div>
        <Bar h={440} className="mt-5 rounded-3xl" />
      </div>
    </div>
  );
}
