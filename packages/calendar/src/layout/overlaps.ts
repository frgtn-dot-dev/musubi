export type OverlapSegment = {
  col: number;
  cols: number;
  endMin: number;
  startMin: number;
};

// Assign greedy columns per transitive overlap cluster. The input order is
// retained after sorting by start time so calendar renderers stay deterministic.
export function assignOverlapColumns<T extends OverlapSegment>(
  input: T[],
): T[] {
  const segments = [...input].sort(
    (left, right) =>
      left.startMin - right.startMin || right.endMin - left.endMin,
  );
  let cluster: T[] = [];
  let columnEnds: number[] = [];

  function flushCluster() {
    for (const segment of cluster) {
      segment.cols = columnEnds.length;
    }

    cluster = [];
    columnEnds = [];
  }

  for (const segment of segments) {
    if (
      cluster.length > 0 &&
      Math.max(...columnEnds) <= segment.startMin
    ) {
      flushCluster();
    }

    let column = columnEnds.findIndex((end) => end <= segment.startMin);

    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(0);
    }

    columnEnds[column] = segment.endMin;
    segment.col = column;
    cluster.push(segment);
  }

  flushCluster();

  return segments;
}
