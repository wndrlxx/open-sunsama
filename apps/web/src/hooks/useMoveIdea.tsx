import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Idea, IdeaBoard, IdeaColumn } from "@open-sunsama/types";
import { getApi } from "@/lib/api";
import { ideaBoardKeys, ideaKeys } from "@/lib/query-keys";
import { placeIdeaInCache, restoreIdeaInCache } from "@/lib/idea-move-cache";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "./use-toast";
import { useUndoRedo, type UndoEntry } from "./useUndoRedo";

export function useMoveIdea() {
  const client = useQueryClient();
  const { record, undo } = useUndoRedo();

  const refresh = (source: string, destination: string) =>
    Promise.all([
      client.invalidateQueries({ queryKey: ideaKeys.byBoard(source) }),
      client.invalidateQueries({ queryKey: ideaKeys.byBoard(destination) }),
      client.invalidateQueries({ queryKey: ideaBoardKeys.lists() }),
    ]);

  return useMutation({
    mutationFn: ({
      idea,
      column,
    }: {
      idea: Idea;
      board: IdeaBoard;
      column: IdeaColumn;
    }) => getApi().ideas.update(idea.id, { columnId: column.id }),
    onMutate: async ({ idea, board, column }) => {
      await Promise.all([
        client.cancelQueries({ queryKey: ideaKeys.byBoard(idea.boardId) }),
        client.cancelQueries({ queryKey: ideaKeys.byBoard(board.id) }),
      ]);
      const original =
        client
          .getQueryData<Idea[]>(ideaKeys.byBoard(idea.boardId))
          ?.find((card) => card.id === idea.id) ?? idea;
      const destination = client.getQueryData<Idea[]>(
        ideaKeys.byBoard(board.id)
      );
      const position =
        Math.max(
          -1,
          ...(destination ?? [])
            .filter((card) => card.columnId === column.id)
            .map((card) => card.position)
        ) + 1;
      placeIdeaInCache(
        client,
        {
          ...original,
          boardId: board.id,
          columnId: column.id,
          position,
        },
        original.boardId
      );
      return { original };
    },
    onError: (error, { idea, board }, context) => {
      restoreIdeaInCache(client, context?.original ?? idea, board.id);
      toast({
        variant: "destructive",
        title: "Could not move idea",
        description: error.message,
      });
    },
    onSuccess: (moved, { idea, board, column }, context) => {
      const original = context?.original ?? idea;
      placeIdeaInCache(client, { ...original, ...moved }, original.boardId);
      const restore = async (columnId: string, position: number) => {
        await getApi().ideas.update(idea.id, { columnId, position });
        await refresh(original.boardId, moved.boardId);
      };
      const entry: UndoEntry = {
        label: `Move idea to ${board.name} / ${column.name}`,
        undo: () => restore(original.columnId, original.position),
        redo: () => restore(moved.columnId, moved.position),
      };
      record(entry);
      toast({
        title: `Moved to ${board.name} / ${column.name}`,
        action: (
          <ToastAction
            altText="Undo move"
            aria-label="Undo move"
            onClick={() => undo(entry)}
          >
            Undo
          </ToastAction>
        ),
      });
    },
    onSettled: (_data, _error, { idea, board }) =>
      refresh(idea.boardId, board.id),
  });
}
