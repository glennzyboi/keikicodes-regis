/** Throwaway diagnostic: what does Stripe's hosted page actually render? */
import { chromium } from "@playwright/test";
import postgres from "postgres";
import Stripe from "stripe";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {} });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-08-26.dahlia" });

async function main() {
  const [cls] = await sql<{ stripe_price_id: string }[]>`
    select stripe_price_id from class_offerings where title = 'Web Design Basics'`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: cls.stripe_price_id, quantity: 1 }],
    success_url: "http://localhost:3000/confirming?order=probe",
    cancel_url: "http://localhost:3000/",
  });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(session.url!);
  await page.waitForLoadState("networkidle");

  const inputs = await page.locator("input:visible").evaluateAll((els) =>
    els.map((e) => ({
      name: (e as HTMLInputElement).name,
      id: e.id,
      placeholder: (e as HTMLInputElement).placeholder,
      type: (e as HTMLInputElement).type,
    })),
  );
  console.log("INPUTS BEFORE:", JSON.stringify(inputs, null, 1));

  const selects = await page.locator("select:visible").evaluateAll((els) =>
    els.map((e) => ({ name: (e as HTMLSelectElement).name, id: e.id })),
  );
  console.log("SELECTS:", JSON.stringify(selects));

  await page.getByPlaceholder("1234 1234 1234 1234").fill("4242424242424242");
  await page.getByPlaceholder("MM / YY").fill("12/30");
  await page.getByPlaceholder("CVC").fill("123");
  const name = page.getByPlaceholder("Full name on card");
  if (await name.isVisible().catch(() => false)) await name.fill("Kai Parent");

  await page.getByTestId("hosted-payment-submit-button").click();
  await page.waitForTimeout(9000);

  console.log("URL AFTER:", page.url());
  const text = await page.locator("body").innerText();
  console.log("VISIBLE TEXT AFTER:\n", text.replace(/\n{2,}/g, "\n").slice(0, 1200));

  await page.screenshot({ path: "test-results/probe.png", fullPage: true });
  await browser.close();
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
