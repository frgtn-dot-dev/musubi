export type Offset = { x: number; y: number };

type Rect = { height: number; left: number; top: number; width: number };

/**
 * Where a dragged layer is allowed to end up.
 *
 * The offset is clamped rather than the pointer: the box stays whole inside the
 * bounds, so a window can never be parked where its own actions are off screen.
 * `base` is the position the layer would have with no offset at all, which is
 * what keeps repeated drags from drifting.
 */
export function clampOffset({
  base,
  bounds,
  offset,
}: {
  base: Rect;
  bounds: Rect;
  offset: Offset;
}): Offset {
  const maxX = bounds.left + bounds.width - base.width - base.left;
  const minX = bounds.left - base.left;
  const maxY = bounds.top + bounds.height - base.height - base.top;
  const minY = bounds.top - base.top;

  return {
    // A box wider than its bounds has no room to move: keep it at the edge
    // rather than letting min beat max and flipping it out the other side.
    x: Math.min(Math.max(offset.x, Math.min(minX, maxX)), Math.max(minX, maxX)),
    y: Math.min(Math.max(offset.y, Math.min(minY, maxY)), Math.max(minY, maxY)),
  };
}
