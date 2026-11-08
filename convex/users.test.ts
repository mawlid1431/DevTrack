import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "user_u", name: "U", email: "u@example.com" });
    const orgId = await ctx.db.insert("organizations", { clerkOrgId: "org_u", name: "Org U", slug: "org-u", plan: "free" });
    await ctx.db.insert("members", { orgId, userId, role: "admin", clerkMembershipId: "mem_u" });
  });
  const as = t.withIdentity({ subject: "user_u", org_id: "org_u" } as never);
  return { t, as };
}

describe("account memory", () => {
  test("the tour is remembered on the account and survives Clerk profile syncs", async () => {
    const { t, as } = await setup();
    expect((await as.query(api.users.current, {}))?.tourCompletedAt).toBeUndefined();

    await as.mutation(api.users.completeTour, {});
    const first = (await as.query(api.users.current, {}))?.tourCompletedAt;
    expect(first).toBeTypeOf("number");

    // Finishing again keeps the original time.
    await as.mutation(api.users.completeTour, {});
    expect((await as.query(api.users.current, {}))?.tourCompletedAt).toBe(first);

    // A Clerk "user.updated" webhook (profile change) must not wipe it.
    await as.mutation(api.users.setLastWorkspace, { slug: "org-u" });
    await t.mutation(internal.webhooks.handleClerkEvent, {
      eventType: "user.updated",
      data: { id: "user_u", first_name: "New", last_name: "Name", email_addresses: [] },
    });
    const after = await as.query(api.users.current, {});
    expect(after?.name).toBe("New Name");
    expect(after?.tourCompletedAt).toBe(first);
    expect(after?.lastOrgSlug).toBe("org-u");
  });

  test("the plan is stored on the workspace and follows Clerk billing", async () => {
    const { t, as } = await setup();
    const plan = async () => (await as.query(api.organizations.current, {}))?.plan;
    expect(await plan()).toBe("free");

    const sub = (items: { status: string; plan: { slug: string } }[]) =>
      t.mutation(internal.webhooks.handleClerkEvent, {
        eventType: "subscription.updated",
        data: { id: "s", status: "active", payer: { organization_id: "org_u" }, items },
      });

    await sub([{ status: "active", plan: { slug: "pro" } }]);
    expect(await plan()).toBe("pro");

    // Signing out and back in changes nothing: the plan lives on the org.
    const again = t.withIdentity({ subject: "user_u", org_id: "org_u" } as never);
    expect((await again.query(api.organizations.current, {}))?.plan).toBe("pro");

    await sub([]);
    expect(await plan()).toBe("free");
  });
});
