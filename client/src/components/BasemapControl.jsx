import { LayersControl, TileLayer } from 'react-leaflet';

const { BaseLayer } = LayersControl;

/**
 * Basemap switcher: real satellite photography (Esri World Imagery) as the
 * default, OpenStreetMap streets as an alternative. Satellite is default so
 * farmers trace true field edges and officers see real ground conditions.
 * Note: Esri World Imagery is free for development/internal use; check Esri
 * terms before production deployment.
 */
export default function BasemapControl({ position = 'bottomright', children }) {
  return (
    <LayersControl position={position}>
      <BaseLayer checked name="Satellite">
        <TileLayer
          maxZoom={19}
          attribution='Imagery &copy; Esri, Maxar, Earthstar Geographics & the GIS User Community'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
      </BaseLayer>
      <BaseLayer name="Streets">
        <TileLayer
          maxZoom={19}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      </BaseLayer>
      {children}
    </LayersControl>
  );
}
