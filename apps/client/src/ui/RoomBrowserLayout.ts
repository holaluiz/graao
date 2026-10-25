/** The list has a bounded grid track: only render rows that fit beside the persistent footer. */
export function roomRowsPerPage(height: number, rowHeight: number, gap: number): number {
  if (!Number.isFinite(height) || !Number.isFinite(rowHeight) || rowHeight <= 0) return 1;
  const spacing = Number.isFinite(gap) ? Math.max(0, gap) : 0;
  return Math.max(1, Math.min(6, Math.floor((Math.max(0, height) + spacing) / (rowHeight + spacing))));
}
