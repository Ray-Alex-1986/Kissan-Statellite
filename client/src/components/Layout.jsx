import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="flag">PK</span>
          <div>
            <strong>Government of Pakistan — MNFSR</strong>
            <small>Farm Monitoring Portal (Satellite + Soil Intelligence)</small>
          </div>
        </div>
        <nav>
          {user?.role === 'farmer' && <Link to="/farmer">My Farms</Link>}
          {user?.role !== 'farmer' && <Link to="/admin">Monitoring Map</Link>}
          {user?.role !== 'farmer' && <Link to="/admin/commodity">Commodity Map</Link>}
          {user?.role !== 'farmer' && <Link to="/admin/compare">Compare</Link>}
          <a href="/api/docs" target="_blank" rel="noreferrer">API</a>
          <span className="whoami">{user?.name} · {user?.role}</span>
          <button className="btn ghost" onClick={() => { logout(); nav('/login'); }}>Logout</button>
        </nav>
      </header>
      <main><Outlet /></main>
      <footer className="foot">
        Data: Copernicus Sentinel-2 (10 m) · ISRIC SoilGrids (250 m, CC BY 4.0) · NASA GIBS MODIS (250–500 m) · Values are estimates — validate with field/lab data.
      </footer>
    </div>
  );
}
