import { beforeEach, describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { Idea } from "@open-sunsama/types";
import { ideaKeys } from "./query-keys";
import { placeIdeaInCache, restoreIdeaInCache } from "./idea-move-cache";

const original: Idea = {
  id: "idea",
  userId: "user",
  title: "Read more",
  notes: "Notes",
  priority: "P1",
  estimatedMins: 30,
  boardId: "source",
  columnId: "source-column",
  position: 2,
  completedAt: null,
  promotedTaskId: "linked-task",
  subtaskCount: 3,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const moved = {
  ...original,
  boardId: "destination",
  columnId: "destination-column",
  position: 5,
};
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient();
});

describe("idea move cache reconciliation", () => {
  it("removes the source and inserts exactly one copy into a loaded destination", () => {
    client.setQueryData(ideaKeys.byBoard("source"), [original]);
    client.setQueryData(ideaKeys.byBoard("destination"), []);
    placeIdeaInCache(client, moved, "source");
    placeIdeaInCache(client, moved, "source");
    expect(client.getQueryData(ideaKeys.byBoard("source"))).toEqual([]);
    expect(client.getQueryData(ideaKeys.byBoard("destination"))).toEqual([
      moved,
    ]);
  });

  it("does not seed an unloaded board with a partial list", () => {
    client.setQueryData(ideaKeys.byBoard("source"), [original]);
    placeIdeaInCache(client, moved, "source");
    expect(
      client.getQueryData(ideaKeys.byBoard("destination"))
    ).toBeUndefined();
  });

  it("rolls back the moved card while preserving unrelated concurrent edits", () => {
    const other = {
      ...original,
      id: "other",
      title: "Edited while move was pending",
    };
    client.setQueryData(ideaKeys.byBoard("source"), [other]);
    client.setQueryData(ideaKeys.byBoard("destination"), [moved]);
    restoreIdeaInCache(client, original, "destination");
    expect(client.getQueryData(ideaKeys.byBoard("source"))).toEqual([
      other,
      original,
    ]);
    expect(client.getQueryData(ideaKeys.byBoard("destination"))).toEqual([]);
  });

  it("does not overwrite a newer copy of the source card on rollback", () => {
    const newer = { ...original, title: "Newer title" };
    client.setQueryData(ideaKeys.byBoard("source"), [newer]);
    restoreIdeaInCache(client, original, "destination");
    expect(client.getQueryData(ideaKeys.byBoard("source"))).toEqual([newer]);
    expect(
      client.getQueryData(ideaKeys.byBoard("destination"))
    ).toBeUndefined();
  });
});
