"use client";

import { requeueNotification } from "@/app/admin/actions";

/**
 * Put a failed message back on the queue.
 *
 * The worker already retries with backoff and gives up after five attempts.
 * This is for after that: someone fixed the address, or the provider outage is
 * over, and the office wants it to go now.
 */
export function ResendNotification({ id }: { id: string }) {
  return (
    <form action={requeueNotification} className="mt-2">
      <input type="hidden" name="notificationId" value={id} />
      <button className="ops-btn">Try again</button>
    </form>
  );
}
