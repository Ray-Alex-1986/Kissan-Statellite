// GeoJSON helpers. Boundaries are GeoJSON Polygon/MultiPolygon in EPSG:4326.

export function centroidOf(boundary) {
  let xs = 0, ys = 0, n = 0;
  const ring = boundary?.type === 'Polygon'
    ? boundary.coordinates[0]
    : boundary?.type === 'MultiPolygon'
      ? boundary.coordinates.flat(1)[0]
      : null;
  if (!ring) return null;
  for (const [x, y] of ring) { xs += x; ys += y; n++; }
  return { lat: ys / n, lon: xs / n };
}

export function polygonAreaHa(boundary) {
  if (boundary?.type !== 'Polygon') return null;
  const ring = boundary.coordinates[0];
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const dLon = ((x2 - x1) * Math.PI) / 180; // spherical excess formula needs radians
    area += dLon * (Math.sin((y2 * Math.PI) / 180) + Math.sin((y1 * Math.PI) / 180));
  }
  return Math.abs((area * 6378137 * 6378137) / 2) / 10000; // ha
}

export function rectangleAround(lat, lon, sizeDeg = 0.004) {
  return {
    type: 'Polygon',
    coordinates: [[
      [lon - sizeDeg, lat - sizeDeg],
      [lon + sizeDeg, lat - sizeDeg],
      [lon + sizeDeg, lat + sizeDeg],
      [lon - sizeDeg, lat + sizeDeg],
      [lon - sizeDeg, lat - sizeDeg],
    ]],
  };
}

export function isValidPolygon(boundary) {
  if (!boundary || boundary.type !== 'Polygon' || !Array.isArray(boundary.coordinates?.[0])) return false;
  const ring = boundary.coordinates[0];
  return ring.length >= 4 && JSON.stringify(ring[0]) === JSON.stringify(ring[ring.length - 1]);
}
