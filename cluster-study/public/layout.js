/**
 * Cluster Study — pure layout helpers (grid snapping §4c, orbital slots §6a.1).
 *
 * Kept DOM/d3-free so the Worker test suite can exercise the logic; app.js
 * imports this in the browser.
 */

/** Grid spacing tied to typical node radius/label width (§4c). */
export const GRID_SPACING = 72;

export const cellKey = (col, row) => `${col},${row}`;

/** The grid cell containing a point. */
export function cellOf(x, y, spacing = GRID_SPACING) {
  return [Math.round(x / spacing), Math.round(y / spacing)];
}

/**
 * Nearest UNOCCUPIED grid point to (x, y) — §4c: plain nearest-point snapping
 * can collide two nodes into one cell, so occupancy is checked with fallback
 * to the next-nearest free cell (expanding ring search).
 *
 * `occupied` is a Set of cellKey strings for every other node's position.
 * Returns { x, y, key }.
 */
export function nearestFreeCell(x, y, occupied, spacing = GRID_SPACING) {
  const [c0, r0] = cellOf(x, y, spacing);
  let best = null;
  // Search rings outward until a free cell is found; ring R can't beat a
  // found candidate once (R-1) * spacing exceeds the best distance.
  for (let ring = 0; ring < 50; ring++) {
    if (best && (ring - 1) * spacing > best.dist) break;
    for (let dc = -ring; dc <= ring; dc++) {
      for (let dr = -ring; dr <= ring; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue; // ring shell only
        const col = c0 + dc;
        const row = r0 + dr;
        const key = cellKey(col, row);
        if (occupied.has(key)) continue;
        const cx = col * spacing;
        const cy = row * spacing;
        const dist = Math.hypot(cx - x, cy - y);
        if (!best || dist < best.dist) best = { x: cx, y: cy, key, dist };
      }
    }
    if (best && ring > 0) break; // found something in or before this shell
  }
  return best ? { x: best.x, y: best.y, key: best.key } : { x, y, key: cellKey(c0, r0) };
}

/**
 * Orbit radius for n children around a parent (§6a.1): adjacent slots need
 * enough chord length that label boxes don't collide, and the orbit must
 * clear the parent — including the parent's own label, which is wider than
 * its circle (parents have long names like "Mark Anthony Brands, Inc.").
 */
export function orbitRadius(n, parentR, maxChildExtent, parentExtent = 0) {
  const chordNeeded = Math.max(70, maxChildExtent + 16);
  const byChord = n > 1 ? chordNeeded / (2 * Math.sin(Math.PI / n)) : 0;
  const byParentLabel = (parentExtent + maxChildExtent) / 2 + 12;
  return Math.max(90, parentR + 55, byChord, byParentLabel);
}

/**
 * Fixed angular slots for children around a parent (§6a.1) — evenly spaced,
 * assigned in order of each child's current angle so nodes travel the least
 * and cross-links stay roughly oriented.
 *
 * children: [{ id, x, y }], parent: { x, y }.
 * Returns Map(childId -> { x, y, angle }).
 */
export function orbitalSlots(parent, children, radius) {
  const n = children.length;
  const slots = new Map();
  if (n === 0) return slots;
  const sorted = [...children].sort(
    (a, b) => Math.atan2(a.y - parent.y, a.x - parent.x) - Math.atan2(b.y - parent.y, b.x - parent.x)
  );
  // Anchor the slot wheel on the first child's existing angle.
  const start = Math.atan2(sorted[0].y - parent.y, sorted[0].x - parent.x);
  sorted.forEach((child, i) => {
    const angle = start + (i * 2 * Math.PI) / n;
    slots.set(child.id, {
      x: parent.x + radius * Math.cos(angle),
      y: parent.y + radius * Math.sin(angle),
      angle,
    });
  });
  return slots;
}
