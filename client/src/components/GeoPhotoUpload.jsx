import { useState } from 'react';
import exifr from 'exifr';
import api, { errMsg } from '../lib/api.js';

/**
 * Geo-tagged field photo capture.
 * Reads EXIF GPS + capture time client-side, then uploads with the coordinates,
 * so the exact photo location can be plotted on the administrator's map.
 */
export default function GeoPhotoUpload({ farmId, cropSeasonId, onUploaded }) {
  const [file, setFile] = useState(null);
  const [meta, setMeta] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (e) => {
    const f = e.target.files?.[0];
    setError('');
    setMeta(null);
    setFile(f || null);
    if (!f) return;
    try {
      const data = await exifr.parse(f, { gps: true, pick: ['latitude', 'longitude', 'DateTimeOriginal'] });
      setMeta({
        lat: data?.latitude ?? null,
        lon: data?.longitude ?? null,
        capturedAt: data?.DateTimeOriginal ? new Date(data.DateTimeOriginal).toISOString() : null,
      });
    } catch {
      setMeta({ lat: null, lon: null, capturedAt: null });
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('photo', file);
      fd.append('farmId', farmId);
      if (cropSeasonId) fd.append('cropSeasonId', cropSeasonId);
      if (meta?.lat != null) fd.append('lat', meta.lat);
      if (meta?.lon != null) fd.append('lon', meta.lon);
      if (meta?.capturedAt) fd.append('capturedAt', meta.capturedAt);
      if (note) fd.append('note', note);
      const { data } = await api.post('/field-photos/upload', fd);
      setFile(null); setNote(''); setMeta(null);
      onUploaded?.(data);
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card geo-photo" onSubmit={submit}>
      <h3>Upload geo-tagged field photo</h3>
      <p className="hint">Take the photo with your phone's camera so GPS coordinates are embedded. The point is plotted on the monitoring map.</p>
      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} />
      {file && meta && (
        <p className={meta.lat != null ? 'ok' : 'warn'}>
          {meta.lat != null
            ? `GPS: ${meta.lat.toFixed(5)}, ${meta.lon.toFixed(5)}${meta.capturedAt ? ` · taken ${new Date(meta.capturedAt).toLocaleString()}` : ''}`
            : 'No GPS coordinates found in this image — enable location when taking field photos.'}
        </p>
      )}
      <input type="text" placeholder="Note (optional, e.g. pest sighting, water stress)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={!file || busy}>{busy ? 'Uploading…' : 'Upload photo'}</button>
    </form>
  );
}
