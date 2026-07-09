import { describe, it, expect } from 'vitest';
import {
  GRID_SPACING,
  cellOf,
  cellKey,
  nearestFreeCell,
  orbitRadius,
  orbitalSlots,
  radialEscape,
} from '../public/layout.js';

describe('snap-to-grid (§4c)', () => {
  it('snaps to the nearest grid point when free', () => {
    const cell = nearestFreeCell(100, 100, new Set());
    expect(cell).toMatchObject({ x: 72, y: 72 });
  });

  it('falls back to the next-nearest free cell when the closest is occupied', () => {
    const occupied = new Set([cellKey(...cellOf(72, 72))]);
    const cell = nearestFreeCell(100, 100, occupied);
    expect(occupied.has(cell.key)).toBe(false);
    expect(cell.x % GRID_SPACING).toBe(0);
    expect(cell.y % GRID_SPACING).toBe(0);
    // Next-nearest to (100,100) once (72,72) is taken is (144,72) or (72,144).
    expect([`${144},${72}`, `${72},${144}`]).toContain(`${cell.x},${cell.y}`);
  });

  it('never lands two nodes on the same cell even in a crowded region', () => {
    const occupied = new Set();
    for (let i = 0; i < 20; i++) {
      const cell = nearestFreeCell(150, 150, occupied);
      expect(occupied.has(cell.key)).toBe(false);
      occupied.add(cell.key);
    }
    expect(occupied.size).toBe(20);
  });
});

describe('orbital layout (§6a.1)', () => {
  it('computes a radius that clears the parent and spaces labels by chord length', () => {
    expect(orbitRadius(4, 24, 60)).toBeGreaterThanOrEqual(90);
    // Wide labels force a wider orbit: chord = 2R·sin(π/n) ≥ label extent.
    const r = orbitRadius(8, 24, 140);
    expect(2 * r * Math.sin(Math.PI / 8)).toBeGreaterThanOrEqual(140);
  });

  it('assigns evenly spaced fixed slots at the orbit radius', () => {
    const parent = { x: 0, y: 0 };
    const children = [
      { id: 'a', x: 100, y: 0 },
      { id: 'b', x: 0, y: 100 },
      { id: 'c', x: -100, y: 0 },
      { id: 'd', x: 0, y: -100 },
    ];
    const slots = orbitalSlots(parent, children, 120);
    expect(slots.size).toBe(4);
    const angles = [...slots.values()].map((s) => s.angle).sort((x, y) => x - y);
    for (const [, s] of slots) {
      expect(Math.hypot(s.x, s.y)).toBeCloseTo(120, 6);
    }
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i] - angles[i - 1]).toBeCloseTo(Math.PI / 2, 6);
    }
  });

  it('radialEscape pushes an inside point to the boundary along its bearing (§6a.1a)', () => {
    const out = radialEscape(30, 40, 0, 0, 100); // dist 50, inside r=100
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(100, 6);
    // Bearing preserved: (30,40) direction is 3-4-5 → boundary at (60,80).
    expect(out.x).toBeCloseTo(60, 6);
    expect(out.y).toBeCloseTo(80, 6);
  });

  it('radialEscape returns null when already clear', () => {
    expect(radialEscape(200, 0, 0, 0, 100)).toBeNull();
    expect(radialEscape(100, 0, 0, 0, 100)).toBeNull(); // exactly on boundary
  });

  it('radialEscape handles the center-coincident case deterministically', () => {
    expect(radialEscape(5, 5, 5, 5, 80)).toEqual({ x: 85, y: 5 });
  });

  it('keeps children near their settled bearings (least travel)', () => {
    const parent = { x: 0, y: 0 };
    const children = [
      { id: 'east', x: 200, y: 5 },
      { id: 'south', x: 5, y: 200 },
    ];
    const slots = orbitalSlots(parent, children, 100);
    // "east" started due east — its slot should stay on the east side.
    expect(slots.get('east').x).toBeGreaterThan(0);
  });
});
