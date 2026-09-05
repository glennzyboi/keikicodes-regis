import { test, expect } from "@playwright/test";
import { signInStaff } from "./helpers";

/**
 * The reported symptom: switching between rail tabs asks for a login again.
 *
 * The console rail is eleven <Link>s, and Next prefetches links in the viewport,
 * so moving around fires many requests at once. If the access token has expired,
 * every one of them tries to refresh it at the same moment. This asks whether
 * that storm survives.
 */
test("an expired token survives a burst of concurrent requests", async ({ page, context }) => {
  await signInStaff(page);

  const age = async () => {
    const auth = (await context.cookies())
      .filter((c) => /^sb-.*-auth-token$/.test(c.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(auth.length, "auth cookie present").toBeGreaterThan(0);

    const raw = auth.map((c) => c.value).join("");
    const json = JSON.parse(Buffer.from(raw.replace(/^base64-/, ""), "base64").toString("utf8"));
    json.expires_at = Math.floor(Date.now() / 1000) - 300;
    json.expires_in = 0;
    const aged = "base64-" + Buffer.from(JSON.stringify(json), "utf8").toString("base64url");
    await context.addCookies([{ ...auth[0], value: aged }]);
  };

  const routes = [
    "/admin",
    "/admin/money",
    "/admin/families",
    "/admin/students",
    "/admin/classes",
    "/admin/schedule",
    "/admin/setup/programs",
    "/admin/setup/campuses",
    "/admin/setup/terms",
    "/admin/holds",
    "/admin/notifications",
  ];

  const burst = async () => {
    const results = await Promise.all(
      routes.map(async (u) => {
        const res = await page.request.get(u, { maxRedirects: 0 });
        return { u, status: res.status(), to: res.headers()["location"] ?? "" };
      }),
    );
    return results.filter((r) => r.to.includes("/admin/login")).map((r) => r.u);
  };

  // One request first: this is the case already covered, and it passes.
  await age();
  const single = await page.request.get("/admin/families", { maxRedirects: 0 });
  console.log("SINGLE after ageing:", single.status(), single.headers()["location"] ?? "");

  // Now the storm.
  await age();
  const first = await burst();
  const second = await burst();
  const third = await burst();
  console.log(
    `BURSTS bounced: first=${first.length}/${routes.length} second=${second.length} third=${third.length}`,
  );
  console.log("first burst bounced:", JSON.stringify(first));
});
