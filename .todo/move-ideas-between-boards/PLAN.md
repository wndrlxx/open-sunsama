# Move ideas between boards

Status: implemented and locally verified on `feat/move-ideas-between-boards`. Deployment and the self-hosted desktop rebuild are separate steps.

## Validation

- API/web typecheck and builds pass. Lint has no errors; new and modified feature files lint cleanly.
- The desktop frontend bundle-size check passes at 33.9 MB, below the 60 MB limit.
- API unit tests: 153 passed, 2 skipped. Web unit tests: 98 passed. Includes 8 new API tests and 4 new cache tests.
- All 9 new browser tests pass against both the development API and built API, using installed Chrome and a disposable native PostgreSQL 16 database. No Docker or existing self-hosted database was used.
- The full browser suite finishes at 39/40 passing. The existing passkey test times out waiting for its sign-in button at `passkeys.spec.ts:47`. The same timeout reproduces against an archived, unchanged `main` at `01010ee`; no passkey code is changed here.
- Light and dark screenshots inspected, including nested-menu bounds at 1024px. Cursor/browser-host tooling was unavailable in this session; browser verification used the automated Chrome suite.
- CI, production deployment, and self-hosted desktop installation are not part of this local feature-branch result.

## Selected interaction

Add **Move to board →** beside **Move to column** in the shared idea-card action list. It appears in both right-click and ⋯ menus, including cards in the planner's Ideas tray.

Opening **Move to board** shows other boards in board-rail order. Each board opens a submenu listing its columns in display order. Selecting a column immediately moves the idea; hovering or opening a board never moves it. Exclude the current board; existing within-board moves keep their current menu. Even boards with one column expose that explicit destination. Use the existing Radix submenu behavior for keyboard navigation, focus restoration, and collision handling. Bound long menus to the available viewport height and let them scroll.

Append the existing card to the destination column. Keep the current board open and show **Moved to Personal / Someday** with **Undo**. Preserve the card ID, notes, checklist and completion state, estimate, priority, and any existing planner-task link. Moving an idea does not create or reschedule a task. Undo restores the original board, column, and position through the shared undo history; redo reapplies the move. Toast Undo targets that move specifically; if newer history entries exist, ask the user to undo those first rather than undoing an unrelated action.

The user selected nested menus over the destination-dialog alternative. No destination dialog or extra confirmation step is planned.

## Existing behavior and gaps

- `apps/web/src/components/ideas/idea-card.tsx` already shares menu items between right-click and ⋯ menus and implements same-board column moves.
- `PATCH /ideas/:id` in `apps/api/src/routes/ideas.ts` accepts `columnId`, verifies column ownership, and derives the destination `boardId`. The API client and shared `UpdateIdeaInput` already support this; no new endpoint or database migration is expected.
- The update handler currently retains the card's old position unless supplied. A menu move therefore needs explicit append behavior on the server.
- `useUpdateIdea` updates only the source-board cache and does not remove a cross-board card from it immediately. A dedicated move mutation should update both boards and preserve rollback state.
- `idea:updated` currently publishes only the destination board. Other clients viewing the source board can retain a stale card until refetch; publish the previous location too.

## Implementation

1. **Nested destination menus and shared action.** Extend the shared `IdeaMenuItems` and menu-family adapters in `idea-card.tsx` with **Move to board → board → column**. Reuse existing board icons and Radix menu components. Load boards when the action opens; load destination columns when a board submenu opens and reuse their query cache. Keep query hooks in small submenu components so they are not called conditionally inside a loop. Wire the same move handler into both menu families. Preserve click/tap access, arrow-key navigation, Escape, focus restoration, and viewport collision handling.
2. **Move mutation.** Add `useMoveIdea` in `useIdeas.ts`. Snapshot the card and source/destination caches, cancel relevant in-flight queries, remove the source card optimistically, and append it to an already-loaded destination cache. Do not create an incomplete destination cache. Prevent repeated submissions. On error, restore affected card/cache state without overwriting unrelated edits and show a retryable error. On settle, refresh both boards and board-list metadata. Register successful moves in the existing undo/redo system and expose the same undo operation in the toast.
3. **Server ordering and events.** Extend the existing PATCH handler so changing column without an explicit position appends after the destination's maximum position. Keep source/destination validation and the update in a transaction; continue deriving board membership from the owned destination column. Preserve explicit positions for undo and existing callers. Include `previousBoardId` and `previousColumnId` in the update event when location changes.
4. **Realtime synchronization.** Update `useWebSocket.ts` to invalidate both source and destination board queries when previous-location fields exist. Continue handling older event payloads. Refresh board metadata and the idea detail/checklist caches as appropriate.
5. **Validate, then ship separately.** Review the full feature diff; run targeted server/cache tests, typecheck, lint, and required CI before merging. Browser-test with throwaway users against a disposable database; use the Cursor browser tool when available. The self-hosted API must receive the server change for ordering and realtime behavior, and the Mac app needs a new self-hosted rebuild for its bundled UI. Deployment and rebuild are separate from this feature-branch implementation.

## Empty, stale, and error states

- No other boards: keep the action disabled with a clear **No other boards** explanation.
- Boards or columns loading: show a disabled **Loading…** menu item; offer a **Retry** item on failure. Never render loading/error placeholders as move destinations.
- Destination has no columns: show a disabled **No columns** item in its submenu. Do not silently create a column.
- Board/column deleted or permission changed after opening: the API rejects the move, the source card is restored, and destinations refresh.
- Move or Undo fails: retain the last confirmed location and show the error; do not report success before the server accepts it.
- Long or duplicate names: preserve board identity with its icon and nested column context; expose full labels accessibly when visual truncation is needed.

## Acceptance checks

- Right-click and ⋯ open the same destination flow from the full Ideas board and planner tray.
- A successful move removes exactly one source card and places that same ID at the destination column's end; reload preserves the result.
- Notes, checklist IDs/completion, estimate, priority, completion, and planner-task links survive unchanged.
- A second tab viewing either affected board refreshes correctly.
- Undo and redo restore the intended location and ordering; failures leave a recoverable state.
- Requests targeting another user's column are rejected. Deleted and empty destinations cannot accept a move.
- Opening or hovering a board does not move the card; selecting a column moves it once, without a confirmation dialog.
- Keyboard-only operation, nested-menu focus restoration, light/dark themes, long-menu scrolling, and narrow-screen submenu collision handling work.

## Scope

Single-card moves between existing boards. Bulk moves, board creation inside the picker, cross-board drag-and-drop, and task conversions remain separate proposals.
