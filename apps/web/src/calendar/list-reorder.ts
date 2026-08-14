/** Move one item to another index, leaving the rest in order. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return items;
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next;
}

export type RowBox = { height: number; top: number };

/**
 * Where a row sits while a drag previews `from → to`.
 *
 * The list keeps its saved order in the DOM and rows are *moved* to their preview
 * slot with a transform, so they glide instead of jumping and the held row can
 * follow the pointer without fighting a re-render.
 */
export function previewIndex(
  index: number,
  from: number,
  to: number,
): number {
  if (index === from) return to;
  if (from < to) return index > from && index <= to ? index - 1 : index;
  return index >= to && index < from ? index + 1 : index;
}

/**
 * Which slot a pointer at `y` is over, given where the rows were when the drag
 * started.
 *
 * Measured once at the start, not per move: the rows shift as the preview order
 * changes, and re-measuring mid-drag would make the row chase the pointer and
 * flicker between two slots. Above the first row or below the last one clamps to
 * the ends, so dragging off the list still lands somewhere sensible.
 */
export function dropIndexAt(y: number, boxes: RowBox[]): number {
  if (boxes.length === 0) return 0;

  for (const [index, box] of boxes.entries()) {
    if (y < box.top + box.height / 2) return index;
  }
  return boxes.length - 1;
}
