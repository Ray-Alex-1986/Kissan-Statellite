import { useEffect, useRef } from 'react';
import { MapContainer, FeatureGroup, Marker, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import BasemapControl from './BasemapControl.jsx';

// Punjab, Pakistan default centre
export const DEFAULT_CENTER = [31.55, 74.1];

function DrawControl({ onBoundary, existing }) {
  const fgRef = useRef(null);
  const map = useMap();

  useEffect(() => {
    if (!fgRef.current) return;
    const drawnItems = fgRef.current;
    const drawControl = new L.Control.Draw({
      draw: {
        polygon: { allowIntersection: false, shapeOptions: { color: '#2e7d32' } },
        rectangle: { shapeOptions: { color: '#2e7d32' } },
        circle: false,
        circlemarker: false,
        marker: false,
        polyline: false,
      },
      edit: { featureGroup: drawnItems, edit: false, remove: true },
      position: 'topleft',
    });
    map.addControl(drawControl);

    const toGeo = (layer) => layer.toGeoJSON().geometry;
    const onCreated = (e) => {
      drawnItems.clearLayers();
      drawnItems.addLayer(e.layer);
      onBoundary(toGeo(e.layer));
    };
    const onEdited = (e) => {
      e.layers.eachLayer((l) => onBoundary(toGeo(l)));
    };
    const onDeleted = () => onBoundary(null);

    map.on(L.Draw.Event.CREATED, onCreated);
    map.on(L.Draw.Event.EDITED, onEdited);
    map.on(L.Draw.Event.DELETED, onDeleted);

    // Preload existing boundary into editable layer
    if (existing?.type === 'Polygon') {
      const coords = existing.coordinates[0].map(([lon, lat]) => [lat, lon]);
      const layer = L.polygon(coords);
      drawnItems.addLayer(layer);
    }
    return () => {
      map.off(L.Draw.Event.CREATED, onCreated);
      map.off(L.Draw.Event.EDITED, onEdited);
      map.off(L.Draw.Event.DELETED, onDeleted);
      map.removeControl(drawControl);
    };
  }, [map, onBoundary, existing]);

  return <FeatureGroup ref={fgRef} />;
}

/**
 * Map for drawing a farm boundary (registration) or displaying one (read-only).
 * Props:
 *   onBoundary(geometry|null) — called whenever the drawn polygon changes
 *   existing — GeoJSON Polygon to prefill/show
 *   marker — [lat, lon] point marker (e.g. from a geo-tagged photo)
 *   height — CSS height
 */
export default function FarmBoundaryMap({ onBoundary, existing, marker, height = '420px', readOnly = false }) {
  const cbRef = useRef(onBoundary);
  cbRef.current = onBoundary;
  const stableHandler = (g) => cbRef.current?.(g);

  return (
    <MapContainer center={existing?.type === 'Polygon' ? centerOf(existing) : DEFAULT_CENTER} zoom={13} style={{ height, width: '100%' }}>
      <BasemapControl />
      {existing?.type === 'Polygon' && (
        <Polygon positions={existing.coordinates[0].map(([lon, lat]) => [lat, lon])} pathOptions={{ color: '#2e7d32', weight: 2 }} />
      )}
      {marker && <Marker position={marker} />}
      {!readOnly && <DrawControl onBoundary={stableHandler} existing={existing} />}
    </MapContainer>
  );
}

export function centerOf(geojson) {
  const ring = geojson.coordinates[0];
  let x = 0, y = 0;
  for (const [lon, lat] of ring) { x += lon; y += lat; }
  return [y / ring.length, x / ring.length];
}
