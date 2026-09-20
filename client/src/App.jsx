import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import FarmerHome from './pages/farmer/FarmerHome.jsx';
import FarmRegister from './pages/farmer/FarmRegister.jsx';
import FarmDetail from './pages/farmer/FarmDetail.jsx';
import AdminMap from './pages/admin/AdminMap.jsx';
import AdminFarmReview from './pages/admin/AdminFarmReview.jsx';
import AdminCompare from './pages/admin/AdminCompare.jsx';
import CommodityMap from './pages/admin/CommodityMap.jsx';

function Guard({ roles, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" />;
  return children;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" />;
  return <Navigate to={user.role === 'farmer' ? '/farmer' : '/admin'} />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route element={<Guard><Layout /></Guard>}>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/farmer" element={<Guard roles={['farmer']}><FarmerHome /></Guard>} />
            <Route path="/farmer/farms/new" element={<Guard roles={['farmer']}><FarmRegister /></Guard>} />
            <Route path="/farmer/farms/:id" element={<Guard roles={['farmer']}><FarmDetail /></Guard>} />
            <Route path="/admin" element={<Guard roles={['officer', 'admin']}><AdminMap /></Guard>} />
            <Route path="/admin/commodity" element={<Guard roles={['officer', 'admin']}><CommodityMap /></Guard>} />
            <Route path="/admin/compare" element={<Guard roles={['officer', 'admin']}><AdminCompare /></Guard>} />
            <Route path="/admin/farms/:id" element={<Guard roles={['officer', 'admin']}><AdminFarmReview /></Guard>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
