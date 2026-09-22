// The track centreline as Unity builds it (centripetal Catmull-Rom through the
// control points), for drawing the minimap.
const knot = (t: number, a: number[], b: number[]) => t + Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5, 1e-4);
const blend = (a: number[], b: number[], ta: number, tb: number, u: number) => [
  ((tb - u) / (tb - ta)) * a[0] + ((u - ta) / (tb - ta)) * b[0],
  ((tb - u) / (tb - ta)) * a[1] + ((u - ta) / (tb - ta)) * b[1],
];

function catmullRom(p0: number[], p1: number[], p2: number[], p3: number[], t: number) {
  const t1 = knot(0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);
  const u = t1 + (t2 - t1) * t;
  const a1 = blend(p0, p1, 0, t1, u);
  const a2 = blend(p1, p2, t1, t2, u);
  const a3 = blend(p2, p3, t2, t3, u);
  return blend(blend(a1, a2, 0, t2, u), blend(a2, a3, t1, t3, u), t1, t2, u);
}

export type Shape = { path: string; toMap: (x: number, z: number) => [number, number]; start: [number, number] };

/** An SVG path in a size x size box, with world z pointing up the map. */
export function trackShape(flat: number[], size: number, pad = 8): Shape {
  const controls: number[][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) controls.push([flat[i], flat[i + 1]]);
  const n = controls.length;
  const points: number[][] = [];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((d) => controls[(i + d + n) % n]);
    for (let s = 0; s < 10; s++) points.push(catmullRom(p0, p1, p2, p3, s / 10));
  }
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const scale = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
  const offX = (size - (maxX - minX) * scale) / 2;
  const offY = (size - (maxZ - minZ) * scale) / 2;
  const toMap = (x: number, z: number): [number, number] => [offX + (x - minX) * scale, offY + (maxZ - z) * scale];
  const path =
    points.map((p, i) => `${i ? "L" : "M"}${toMap(p[0], p[1]).map((v) => v.toFixed(1)).join(" ")}`).join("") + "Z";
  return { path, toMap, start: toMap(controls[0][0], controls[0][1]) };
}
