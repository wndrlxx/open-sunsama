import { expect, test, type Page } from "@playwright/test";
import type { Idea, IdeaBoard, IdeaColumn } from "@open-sunsama/types";

const API = `http://localhost:${process.env.API_PORT ?? 3201}`;
type Session = { token: string; user: unknown };

async function request<T>(
  method: string,
  path: string,
  token?: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
  return ((await response.json()) as { data: T }).data;
}

async function setup() {
  const session = await request<Session>("POST", "/auth/register", undefined, {
    email: `move-ideas-${crypto.randomUUID()}-e2e@example.com`,
    password: "E2e-Passw0rd",
    name: "Ideas E2E",
  });
  const board = (name: string) =>
    request<IdeaBoard & { columns: IdeaColumn[] }>(
      "POST",
      "/ideas/boards",
      session.token,
      { name }
    );
  const source = await board("Work ideas");
  const destination = await board("Personal ideas");
  const column = await request<IdeaColumn>(
    "POST",
    "/ideas/columns",
    session.token,
    { boardId: destination.id, name: "Next up" }
  );
  const idea = await request<Idea>("POST", "/ideas", session.token, {
    boardId: source.id,
    columnId: source.columns[0]!.id,
    title: "Learn conversational Spanish",
    notes: "Keep my language notes",
    estimatedMins: 30,
    priority: "P1",
  });
  const checklist = await request<{ id: string }>(
    "POST",
    `/ideas/${idea.id}/subtasks`,
    session.token,
    { title: "Find a conversation partner" }
  );
  const existing = await request<Idea>("POST", "/ideas", session.token, {
    boardId: destination.id,
    columnId: column.id,
    title: "Existing destination idea",
    position: 8,
  });
  return { session, source, destination, column, idea, checklist, existing };
}

async function signIn(page: Page, session: Session) {
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem("open_sunsama_token", token);
    localStorage.setItem("open_sunsama_user", JSON.stringify(user));
  }, session);
  await page.goto("/app/ideas");
  await expect(
    page
      .locator("[data-idea-id]")
      .filter({ hasText: "Learn conversational Spanish" })
  ).toBeVisible();
}

async function openDestination(
  page: Page,
  idea: Idea,
  mode: "context" | "dropdown"
) {
  const card = page.locator("[data-idea-id]").filter({ hasText: idea.title });
  if (mode === "context") await card.click({ button: "right" });
  else {
    await card.hover();
    await card.getByRole("button", { name: "Idea actions" }).click();
  }
  const boards = page.getByRole("menuitem", {
    name: "Move to board",
    exact: true,
  });
  await boards.focus();
  await page.keyboard.press("ArrowRight");
  const destination = page.getByRole("menuitem", {
    name: "Personal ideas",
    exact: true,
  });
  await expect(destination).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Work ideas", exact: true })
  ).toHaveCount(0);
  await destination.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("menuitem", { name: "Next up", exact: true })
  ).toBeVisible();
}

for (const mode of ["context", "dropdown"] as const) {
  test(`moves an idea through the ${mode} nested menu, syncs other tabs, and supports undo`, async ({
    page,
    context,
  }) => {
    const fixture = await setup();
    await signIn(page, fixture.session);
    const otherTab = await context.newPage();
    await signIn(otherTab, fixture.session);
    await openDestination(page, fixture.idea, mode);
    await test.info().attach(`${mode} nested menus`, {
      body: await page.screenshot({
        path: test.info().outputPath(`${mode}-nested-menus.png`),
      }),
      contentType: "image/png",
    });
    // Opening a board submenu must not itself move the card.
    expect(
      (
        await request<Idea>(
          "GET",
          `/ideas/${fixture.idea.id}`,
          fixture.session.token
        )
      ).boardId
    ).toBe(fixture.source.id);
    await page.getByRole("menuitem", { name: "Next up", exact: true }).click();
    await expect(
      page.getByText("Moved to Personal ideas / Next up", { exact: true })
    ).toBeVisible();
    await expect(
      page.locator(`[data-idea-id="${fixture.idea.id}"]`)
    ).toHaveCount(0);
    await expect(
      otherTab.locator(`[data-idea-id="${fixture.idea.id}"]`)
    ).toHaveCount(0);
    const moved = await request<Idea & { subtasks: { id: string }[] }>(
      "GET",
      `/ideas/${fixture.idea.id}`,
      fixture.session.token
    );
    expect(moved).toMatchObject({
      id: fixture.idea.id,
      boardId: fixture.destination.id,
      columnId: fixture.column.id,
      notes: fixture.idea.notes,
      priority: "P1",
      estimatedMins: 30,
      position: 9,
    });
    expect(moved.subtasks.map((item) => item.id)).toContain(
      fixture.checklist.id
    );
    await page.getByRole("button", { name: "Undo move", exact: true }).click();
    await expect(
      page.locator(`[data-idea-id="${fixture.idea.id}"]`)
    ).toBeVisible();
    await expect(
      otherTab.locator(`[data-idea-id="${fixture.idea.id}"]`)
    ).toBeVisible();
    const restored = await request<Idea>(
      "GET",
      `/ideas/${fixture.idea.id}`,
      fixture.session.token
    );
    expect(restored).toMatchObject({
      boardId: fixture.source.id,
      columnId: fixture.idea.columnId,
      position: fixture.idea.position,
    });
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(
      page.locator(`[data-idea-id="${fixture.idea.id}"]`)
    ).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await request<Idea>(
              "GET",
              `/ideas/${fixture.idea.id}`,
              fixture.session.token
            )
          ).boardId
      )
      .toBe(fixture.destination.id);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(
      page.locator(`[data-idea-id="${fixture.idea.id}"]`)
    ).toBeVisible();
    await page.reload();
    await expect(
      page.locator(`[data-idea-id="${fixture.idea.id}"]`)
    ).toBeVisible();
  });
}

test("restores the source card when a destination was deleted after opening its menu", async ({
  page,
}) => {
  const fixture = await setup();
  await signIn(page, fixture.session);
  await openDestination(page, fixture.idea, "context");
  // Hold the rendered destination steady while the server rejects the stale selection.
  await page.route(`**/ideas/${fixture.idea.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    await request(
      "DELETE",
      `/ideas/columns/${fixture.column.id}`,
      fixture.session.token
    );
    return route.continue();
  });
  await page.getByRole("menuitem", { name: "Next up", exact: true }).click();
  await expect(
    page.getByText("Could not move idea", { exact: true })
  ).toBeVisible();
  await expect(
    page.locator(`[data-idea-id="${fixture.idea.id}"]`)
  ).toBeVisible();
  expect(
    (
      await request<Idea>(
        "GET",
        `/ideas/${fixture.idea.id}`,
        fixture.session.token
      )
    ).boardId
  ).toBe(fixture.source.id);
});

test("moves from the planner tray and keeps the user on the planner", async ({
  page,
}) => {
  const fixture = await setup();
  await signIn(page, fixture.session);
  await page.goto("/app");
  await page
    .getByRole("navigation", { name: "Right panel" })
    .getByRole("button", { name: "Ideas", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Ideas tray" })
      .getByText(fixture.idea.title, { exact: true })
  ).toBeVisible();
  await openDestination(page, fixture.idea, "context");
  await page.getByRole("menuitem", { name: "Next up", exact: true }).click();
  await expect(
    page.getByText("Moved to Personal ideas / Next up", { exact: true })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/app(?:\/board)?$/);
  await expect(page.locator(`[data-idea-id="${fixture.idea.id}"]`)).toHaveCount(
    0
  );
});

test("shows disabled empty destinations instead of moving to an arbitrary column", async ({
  page,
}) => {
  const fixture = await setup();
  await request(
    "DELETE",
    `/ideas/columns/${fixture.column.id}`,
    fixture.session.token
  );
  await request(
    "DELETE",
    `/ideas/columns/${fixture.destination.columns[0]!.id}`,
    fixture.session.token
  );
  await signIn(page, fixture.session);
  await page
    .locator(`[data-idea-id="${fixture.idea.id}"]`)
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Move to board", exact: true })
    .hover();
  await page
    .getByRole("menuitem", { name: "Personal ideas", exact: true })
    .hover();
  await expect(
    page.getByRole("menuitem", { name: "No columns", exact: true })
  ).toBeDisabled();
  expect(
    (
      await request<Idea>(
        "GET",
        `/ideas/${fixture.idea.id}`,
        fixture.session.token
      )
    ).boardId
  ).toBe(fixture.source.id);
});

test("explains when no other boards exist", async ({ page }) => {
  const fixture = await setup();
  await request(
    "DELETE",
    `/ideas/boards/${fixture.destination.id}`,
    fixture.session.token
  );
  await signIn(page, fixture.session);
  await page
    .locator(`[data-idea-id="${fixture.idea.id}"]`)
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Move to board", exact: true })
    .hover();
  await expect(
    page.getByRole("menuitem", { name: "No other boards", exact: true })
  ).toBeDisabled();
});

test("loads columns on demand and can retry a failed destination lookup", async ({
  page,
}) => {
  const fixture = await setup();
  await signIn(page, fixture.session);
  let fail = true;
  let requests = 0;
  await page.route(
    `**/ideas/columns?boardId=${fixture.destination.id}`,
    (route) => {
      requests += 1;
      return fail
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({
              success: false,
              error: { message: "Temporary failure" },
            }),
          })
        : route.continue();
    }
  );
  await page
    .locator(`[data-idea-id="${fixture.idea.id}"]`)
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Move to board", exact: true })
    .hover();
  await expect(
    page.getByRole("menuitem", { name: "Personal ideas", exact: true })
  ).toBeVisible();
  expect(requests).toBe(0);
  await page
    .getByRole("menuitem", { name: "Personal ideas", exact: true })
    .hover();
  const retry = page.getByRole("menuitem", {
    name: "Could not load columns · Retry",
    exact: true,
  });
  await expect(retry).toBeVisible();
  fail = false;
  await retry.click();
  await expect(
    page.getByRole("menuitem", { name: "Next up", exact: true })
  ).toBeVisible();
});

test("native submenus remain visible in a narrow dark workspace", async ({
  page,
}) => {
  const fixture = await setup();
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.emulateMedia({ colorScheme: "dark" });
  await signIn(page, fixture.session);
  await openDestination(page, fixture.idea, "dropdown");
  for (const menu of await page.getByRole("menu").all()) {
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1024);
  }
  await test.info().attach("narrow dark nested menus", {
    body: await page.screenshot({
      path: test.info().outputPath("narrow-dark-nested-menus.png"),
    }),
    contentType: "image/png",
  });
  await page.keyboard.press("Escape");
  expect(
    (
      await request<Idea>(
        "GET",
        `/ideas/${fixture.idea.id}`,
        fixture.session.token
      )
    ).boardId
  ).toBe(fixture.source.id);
});

test("API moves serialize append positions and preserve completion and planner linkage", async () => {
  const fixture = await setup();
  const promoted = await request<{ task: { id: string } }>(
    "POST",
    `/ideas/${fixture.idea.id}/promote`,
    fixture.session.token,
    {}
  );
  const completedAt = "2026-11-10T10:00:00.000Z";
  await request("PATCH", `/ideas/${fixture.idea.id}`, fixture.session.token, {
    completedAt,
  });
  const another = await request<Idea>("POST", "/ideas", fixture.session.token, {
    boardId: fixture.source.id,
    columnId: fixture.idea.columnId,
    title: "Another idea",
  });
  const moved = await Promise.all(
    [fixture.idea, another].map((idea) =>
      request<Idea>("PATCH", `/ideas/${idea.id}`, fixture.session.token, {
        columnId: fixture.column.id,
      })
    )
  );
  expect(moved.map((idea) => idea.position).sort((a, b) => a - b)).toEqual([
    9, 10,
  ]);
  expect(moved[0]).toMatchObject({
    completedAt,
    promotedTaskId: promoted.task.id,
  });
  const foreign = await setup();
  const response = await fetch(`${API}/ideas/${fixture.idea.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${fixture.session.token}`,
    },
    body: JSON.stringify({ columnId: foreign.column.id }),
  });
  expect(response.status).toBe(404);
  expect(
    (
      await request<Idea>(
        "GET",
        `/ideas/${fixture.idea.id}`,
        fixture.session.token
      )
    ).boardId
  ).toBe(fixture.destination.id);
});
