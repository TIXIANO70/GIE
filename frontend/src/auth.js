import { api } from './api.js';

// ==================== ESTADO DE AUTENTICACIÓN ====================
let _perfil = null;

export function getPerfil() { return _perfil; }
export function setPerfil(p) { _perfil = p; }
export function setPerfilCursos(cursos) { if (_perfil) _perfil.cursos = cursos; }
export function esRegente() {
    return ['regente', 'subregente', 'rector', 'vicerector', 'jefe_de_taller'].includes(_perfil?.rol);
}

// ==================== VISIBILIDAD ====================
export function showLogin() {
    const loginEl = document.getElementById('login');
    const appEl = document.getElementById('appContainer');
    if (loginEl) loginEl.classList.remove('hidden');
    if (appEl) appEl.classList.add('hidden');
}

export function showApp() {
    const loginEl = document.getElementById('login');
    const appEl = document.getElementById('appContainer');
    if (loginEl) loginEl.classList.add('hidden');
    if (appEl) appEl.classList.remove('hidden');
}

// ==================== SESIÓN ====================
export async function restoreSession() {
    const token = api.getToken();
    if (!token) {
        _perfil = null;
        return null;
    }

    try {
        const res = await api.me();
        if (res.ok && res.user) {
            _perfil = res.user;
            return _perfil;
        }
        api.clearSession();
        _perfil = null;
        return null;
    } catch (err) {
        console.warn('[GIE] Error restaurando sesión:', err.message);
        api.clearSession();
        _perfil = null;
        return null;
    }
}

export async function clearSession() {
    api.clearSession();
    sessionStorage.clear();
    _perfil = null;
}

// ==================== LOGIN ====================
export async function doLogin(email, password) {
    try {
        const res = await api.login(email, password);
        if (res.ok && res.user) {
            _perfil = res.user;
            return { ok: true };
        }
        return { ok: false, error: res.error || 'Credenciales inválidas' };
    } catch (err) {
        return { ok: false, error: err.message || 'Error de conexión con el servidor' };
    }
}

// ==================== LOGOUT ====================
export async function doLogout() {
    await clearSession();
    showLogin();
}

// ==================== UI HELPERS ====================
export function updateAuthUI() {
    if (!_perfil) return;
    const nombreCompleto = `${_perfil.nombre} ${_perfil.apellido}`;
    const iniciales = `${(_perfil.nombre || 'U')[0]}${(_perfil.apellido || 'G')[0]}`;

    const userName = document.getElementById('userName');
    if (userName) userName.textContent = nombreCompleto;

    const userInitials = document.getElementById('userInitials');
    if (userInitials) userInitials.textContent = iniciales;

    const userRole = document.getElementById('userRole');
    if (userRole) userRole.textContent = _perfil.rol;

    const headerUserName = document.getElementById('headerUserName');
    if (headerUserName) headerUserName.textContent = nombreCompleto;

    const headerUserInitials = document.getElementById('headerUserInitials');
    if (headerUserInitials) headerUserInitials.textContent = iniciales;

    const headerUserRole = document.getElementById('headerUserRole');
    if (headerUserRole) headerUserRole.textContent = _perfil.rol;
}

export function setupLoginForm(onSuccess, onError) {
    const form = document.getElementById('loginForm');
    const btn = document.getElementById('txtBtn');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value.trim().toLowerCase();
        const password = document.getElementById('password').value;
        if (btn) btn.textContent = 'Verificando...';

        const result = await doLogin(email, password);
        if (btn) btn.textContent = 'Ingresar';

        if (result.ok) {
            form.reset();
            if (onSuccess) onSuccess(_perfil);
        } else {
            if (onError) onError(result.error);
        }
    });
}

export function setupLogoutButton(onLogout) {
    const btn = document.getElementById('logoutBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        await doLogout();
        if (onLogout) onLogout();
    });
}

export function setupLoginBanner() {
    const demoCreds = document.getElementById('demoCreds');
    const modoDemoBox = document.getElementById('modoDemoBox');

    if (demoCreds) demoCreds.classList.add('hidden');
    if (modoDemoBox) modoDemoBox.classList.add('hidden');
}
