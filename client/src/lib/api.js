import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.includes('/auth/')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!location.pathname.startsWith('/login')) location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const errMsg = (e) => e.response?.data?.error || e.message || 'Request failed';
export default api;
