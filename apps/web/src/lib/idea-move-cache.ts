import type { QueryClient } from "@tanstack/react-query";
import type { Idea } from "@open-sunsama/types";
import { ideaKeys } from "./query-keys";

/** Update only loaded board lists; never seed a partial destination board. */
export function placeIdeaInCache(
  client: QueryClient,
  idea: Idea,
  fromBoardId: string
) {
  client.setQueryData<Idea[]>(ideaKeys.byBoard(fromBoardId), (old) =>
    old?.filter((card) => card.id !== idea.id)
  );
  client.setQueryData<Idea[]>(ideaKeys.byBoard(idea.boardId), (old) =>
    old
      ? [...old.filter((card) => card.id !== idea.id), idea].sort(
          (a, b) => a.position - b.position
        )
      : undefined
  );
}

/** Roll back this card only, preserving unrelated edits made during the move. */
export function restoreIdeaInCache(
  client: QueryClient,
  original: Idea,
  destinationBoardId: string
) {
  client.setQueryData<Idea[]>(ideaKeys.byBoard(destinationBoardId), (old) =>
    old?.filter((card) => card.id !== original.id)
  );
  client.setQueryData<Idea[]>(ideaKeys.byBoard(original.boardId), (old) => {
    if (!old || old.some((card) => card.id === original.id)) return old;
    return [...old, original].sort((a, b) => a.position - b.position);
  });
}
