import axios from 'axios';

// In production (Vercel), set VITE_API_URL to your Railway backend URL.
// Must include protocol: https://xxxx.up.railway.app (NOT just xxxx.up.railway.app)
// In development, Vite's proxy forwards /api → localhost:3001.
let apiBase = import.meta.env.VITE_API_URL || '';
// Defensive: auto-add https:// if the value was set without a protocol
if (apiBase && !apiBase.startsWith('http://') && !apiBase.startsWith('https://')) {
  apiBase = `https://${apiBase}`;
}
const BASE_URL = apiBase ? `${apiBase}/api` : '/api';

const client = axios.create({ baseURL: BASE_URL });

// Attach JWT token to every request
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Redirect to login on 401
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default client;
