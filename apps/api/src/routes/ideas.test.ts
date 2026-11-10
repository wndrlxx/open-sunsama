import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { signToken } from "../lib/jwt.js";
import { errorHandler } from "../middleware/error.js";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), publishEvent: vi.fn() }));
vi.mock("@open-sunsama/database", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDb: mocks.getDb,
}));
vi.mock("../lib/websocket/index.js", () => ({
  publishEvent: mocks.publishEvent,
}));
import { ideasRouter } from "./ideas.js";

const USER = "b1593d7c-102c-49df-8fa8-5e5fc70abe03";
const IDEA = "60e68bb9-5d12-4c1f-8a77-4579e403ff24";
const SOURCE = "8d796a75-0c5f-47b3-8eb9-792663fbbdba";
const TARGET = "eb161c18-3227-4a19-bd38-e253804c2c0b";
const original = {
  id: IDEA,
  userId: USER,
  boardId: "source-board",
  columnId: SOURCE,
  position: 2,
  title: "Read more",
  notes: "Keep notes",
  priority: "P1",
  estimatedMins: 30,
  completedAt: "2026-11-10T10:00:00.000Z",
  promotedTaskId: "linked-task",
};
const target = { id: TARGET, boardId: "destination-board", userId: USER };
const app = new Hono().route("/ideas", ideasRouter).onError(errorHandler);
let results: unknown[][];
let predicates: SQL[];
let changes: Record<string, unknown>;
const transaction = vi.fn();
const update = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  results = [[original], [target], [{ position: 8 }]];
  predicates = [];
  changes = {};
  function chain() {
    return {
      from: () => chain(),
      limit: () => chain(),
      for: () => chain(),
      where: (predicate: SQL) => {
        predicates.push(predicate);
        return chain();
      },
      set: (input: Record<string, unknown>) => {
        changes = input;
        return chain();
      },
      returning: async () => [{ ...original, ...changes }],
      then: (resolve: (value: unknown[]) => unknown) =>
        Promise.resolve(results.shift() ?? []).then(resolve),
    };
  }
  update.mockImplementation(chain);
  const db = { select: chain, update, transaction };
  transaction.mockImplementation((run: (db: object) => Promise<unknown>) =>
    run(db)
  );
  mocks.getDb.mockReturnValue(db);
});

function patch(input: unknown) {
  return app.request(`/ideas/${IDEA}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signToken(USER)}`,
    },
    body: JSON.stringify(input),
  });
}

describe("moving an idea", () => {
  it("appends to the destination and preserves card content and planner links", async () => {
    const response = await patch({ columnId: TARGET });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: typeof original };
    expect(json.data).toMatchObject({
      ...original,
      boardId: target.boardId,
      columnId: TARGET,
      position: 9,
    });
    expect(Object.keys(changes).sort()).toEqual([
      "boardId",
      "columnId",
      "position",
      "updatedAt",
    ]);
    expect(transaction).toHaveBeenCalledOnce();
    expect(mocks.publishEvent).toHaveBeenCalledWith(USER, "idea:updated", {
      ideaId: IDEA,
      boardId: target.boardId,
      columnId: TARGET,
      previousBoardId: original.boardId,
      previousColumnId: SOURCE,
    });
    const queries = predicates.map((predicate) =>
      new PgDialect().sqlToQuery(predicate)
    );
    expect(queries[0]?.params).toEqual([IDEA, USER]);
    expect(queries[1]?.params).toEqual([TARGET, USER]);
    expect(queries[2]?.params).toEqual([TARGET, USER]);
    expect(queries[3]?.params).toEqual([IDEA, USER]);
  });

  it("starts at zero when moving to an empty column", async () => {
    results = [[original], [target], [{ position: -1 }]];
    expect((await patch({ columnId: TARGET })).status).toBe(200);
    expect(changes.position).toBe(0);
  });

  it("honors an explicit position so undo can restore ordering", async () => {
    results = [[original], [target]];
    expect((await patch({ columnId: TARGET, position: 4 })).status).toBe(200);
    expect(changes.position).toBe(4);
    expect(results).toHaveLength(0);
  });

  it("does not change ordering when the card stays in the same column", async () => {
    results = [
      [original],
      [{ ...target, id: SOURCE, boardId: original.boardId }],
    ];
    expect((await patch({ columnId: SOURCE })).status).toBe(200);
    expect(changes.position).toBeUndefined();
  });

  it("keeps ordinary field updates independent of destination lookup", async () => {
    results = [[original]];
    expect((await patch({ title: "Updated" })).status).toBe(200);
    expect(changes.title).toBe("Updated");
    expect(changes.boardId).toBeUndefined();
    expect(changes.position).toBeUndefined();
  });

  it("rejects a missing or foreign destination without updating or publishing", async () => {
    results = [[original], []];
    expect((await patch({ columnId: TARGET })).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
    expect(mocks.publishEvent).not.toHaveBeenCalled();
    expect(new PgDialect().sqlToQuery(predicates[1]!).params).toEqual([
      TARGET,
      USER,
    ]);
  });

  it("rejects a missing or foreign source before looking up the destination", async () => {
    results = [[]];
    expect((await patch({ columnId: TARGET })).status).toBe(404);
    expect(predicates).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("validates the destination and ordering before opening a transaction", async () => {
    expect((await patch({ columnId: "not-a-uuid" })).status).toBe(400);
    expect((await patch({ columnId: TARGET, position: -1 })).status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });
});
