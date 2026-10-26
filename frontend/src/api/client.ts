import axios from 'axios';

export const AUTH_EXPIRED_EVENT = 'kk:auth-expired';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '',
  withCredentials: true,
  // Das Backend lehnt schreibende Anfragen ohne diesen Header ab (Schutz gegen CSRF)
  headers: { 'X-Requested-With': 'XMLHttpRequest' }
});

api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error.response?.status === 401 && !String(error.config?.url ?? '').startsWith('/api/auth/')) {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    return Promise.reject(error);
  }
);

export type AuthUser = {
  id: number;
  email: string;
  roles: string[];
  permissions: string[];
};
