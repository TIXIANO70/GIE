import { api } from './api.js';

const MIN_SYNC_INTERVAL_MS = 60 * 1000;
let _lastAlumnosSync = 0;

/**
 * Solicita la sincronización de alumnos desde Nexus hacia GIE
 * a través del endpoint /api/alumnos/sync del backend propio.
 */
export async function sincronizarAlumnosDesdeEdge(forzar = false) {
    const ahora = Date.now();
    if (!forzar && (ahora - _lastAlumnosSync) < MIN_SYNC_INTERVAL_MS) {
        return { ok: true, sincronizados: 0, cached: true };
    }

    if (typeof window !== 'undefined' && typeof window.mostrarToast === 'function') {
        window.mostrarToast('Sincronizando alumnos desde Nexus...', 'info');
    }

    try {
        const res = await api.sincronizarAlumnos();
        _lastAlumnosSync = ahora;
        if (res && res.offline) {
            console.info('[GIE] Nexus Gateway offline, operando con base local:', res.message || 'offline');
            return { ok: false, offline: true, sincronizados: 0 };
        }
        console.log('[GIE] Nexus sincronizado exitosamente:', res);
        return { ok: true, ...res };
    } catch (err) {
        console.info('[GIE] Servicio de sincronización Nexus no disponible:', err.message || err);
        return { ok: false, offline: true, error: err.message, sincronizados: 0 };
    }
}
