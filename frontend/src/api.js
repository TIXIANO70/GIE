// ============================================================
// GIE On-Premise - Cliente API Nativo
// Reemplaza @supabase/supabase-js por llamadas REST directas
// ============================================================

const TOKEN_KEY = 'gie_auth_token';
const USER_KEY = 'gie_auth_user';

export const api = {
    getToken() {
        return localStorage.getItem(TOKEN_KEY);
    },

    setSession(token, user) {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    },

    getUser() {
        try {
            const raw = localStorage.getItem(USER_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    },

    clearSession() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
    },

    async request(endpoint, options = {}) {
        const token = this.getToken();
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        let url = endpoint.startsWith('http') ? endpoint : `/api${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

        if (options.params) {
            const searchParams = new URLSearchParams();
            for (const [key, val] of Object.entries(options.params)) {
                if (val !== undefined && val !== null && val !== '') {
                    searchParams.append(key, val);
                }
            }
            const qs = searchParams.toString();
            if (qs) {
                url += (url.includes('?') ? '&' : '?') + qs;
            }
        }

        const fetchOptions = {
            ...options,
            headers
        };

        if (options.body && typeof options.body === 'object') {
            fetchOptions.body = JSON.stringify(options.body);
        }

        try {
            const res = await fetch(url, fetchOptions);
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                if (res.status === 401) {
                    this.clearSession();
                    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
                        // Notificar expiración de sesión si corresponde
                    }
                }
                const errorMsg = data.error || `Error ${res.status}: ${res.statusText}`;
                const err = new Error(errorMsg);
                err.status = res.status;
                err.data = data;
                throw err;
            }

            return data;
        } catch (err) {
            throw err;
        }
    },

    get(endpoint, params) {
        return this.request(endpoint, { method: 'GET', params });
    },

    post(endpoint, body) {
        return this.request(endpoint, { method: 'POST', body });
    },

    put(endpoint, body) {
        return this.request(endpoint, { method: 'PUT', body });
    },

    delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    },

    // Métodos de dominio directos
    async login(email, password) {
        const res = await this.post('/auth/login', { email, password });
        if (res.ok && res.token) {
            this.setSession(res.token, res.user);
        }
        return res;
    },

    async me() {
        return this.get('/auth/me');
    },

    async sincronizarAlumnos() {
        return this.post('/alumnos/sync', {});
    }
};
