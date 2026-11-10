import * as React from "react";
import { ArrowRightLeft } from "lucide-react";
import type { IdeaBoard, IdeaColumn } from "@open-sunsama/types";
import { useIdeaBoards, useIdeaColumns } from "@/hooks/useIdeas";
import { BoardIcon } from "./board-icon";
import type {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuPortal,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui";

/** Shared Radix primitives for the context and dropdown menu variants. */
export interface MoveMenuFamily {
  Item: typeof ContextMenuItem | typeof DropdownMenuItem;
  Sub: typeof ContextMenuSub | typeof DropdownMenuSub;
  SubTrigger: typeof ContextMenuSubTrigger | typeof DropdownMenuSubTrigger;
  SubContent: typeof ContextMenuSubContent | typeof DropdownMenuSubContent;
  Portal: typeof ContextMenuPortal | typeof DropdownMenuPortal;
}

interface MoveToBoardMenuProps {
  family: MoveMenuFamily;
  boardId: string;
  disabled: boolean;
  onMove: (board: IdeaBoard, column: IdeaColumn) => void;
}

const MENU_CLASS =
  "max-h-[var(--radix-popper-available-height)] w-56 overflow-y-auto";

export function MoveToBoardMenu({
  family: C,
  boardId,
  disabled,
  onMove,
}: MoveToBoardMenuProps) {
  const [open, setOpen] = React.useState(false);
  const boards = useIdeaBoards(open);
  const destinations = (boards.data ?? []).filter(
    (board) => board.id !== boardId
  );

  return (
    <C.Sub open={open} onOpenChange={setOpen}>
      <C.SubTrigger disabled={disabled}>
        <ArrowRightLeft className="mr-2 h-4 w-4" />
        Move to board
      </C.SubTrigger>
      <C.Portal>
        <C.SubContent className={MENU_CLASS}>
          {boards.isPending ? (
            <C.Item disabled>Loading boards…</C.Item>
          ) : boards.isError ? (
            <C.Item
              onSelect={(event: Event) => {
                event.preventDefault();
                void boards.refetch();
              }}
            >
              Could not load boards · Retry
            </C.Item>
          ) : destinations.length === 0 ? (
            <C.Item disabled>No other boards</C.Item>
          ) : (
            destinations.map((board) => (
              <BoardDestination
                key={board.id}
                family={C}
                board={board}
                disabled={disabled}
                onMove={onMove}
              />
            ))
          )}
        </C.SubContent>
      </C.Portal>
    </C.Sub>
  );
}

function BoardDestination({
  family: C,
  board,
  disabled,
  onMove,
}: Omit<MoveToBoardMenuProps, "boardId"> & { board: IdeaBoard }) {
  const [open, setOpen] = React.useState(false);
  const columns = useIdeaColumns(board.id, open);

  return (
    <C.Sub open={open} onOpenChange={setOpen}>
      <C.SubTrigger disabled={disabled}>
        <BoardIcon icon={board.icon} color={board.color} size={18} />
        <span className="truncate" title={board.name}>
          {board.name}
        </span>
      </C.SubTrigger>
      <C.Portal>
        <C.SubContent className={MENU_CLASS}>
          {columns.isPending ? (
            <C.Item disabled>Loading columns…</C.Item>
          ) : columns.isError ? (
            <C.Item
              onSelect={(event: Event) => {
                event.preventDefault();
                void columns.refetch();
              }}
            >
              Could not load columns · Retry
            </C.Item>
          ) : columns.data.length === 0 ? (
            <C.Item disabled>No columns</C.Item>
          ) : (
            columns.data.map((column) => (
              <C.Item
                key={column.id}
                disabled={disabled}
                onSelect={() => onMove(board, column)}
              >
                <span className="truncate" title={column.name}>
                  {column.name}
                </span>
              </C.Item>
            ))
          )}
        </C.SubContent>
      </C.Portal>
    </C.Sub>
  );
}
