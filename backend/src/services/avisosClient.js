const AVISOS_INTERNAL_URL = process.env.AVISOS_INTERNAL_URL || 'http://avisos-backend:3002/api/internal/notificar';
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || 'red35_internal_bridge_secret_key';
const AVISOS_TIMEOUT_MS = Number(process.env.AVISOS_TIMEOUT_MS) || 3500;

const INSTANCIAS_CRITICAS = new Set(['grave', 'muy_grave', 'consejo_aula', 'consejo']);

export function esInstanciaCritica(instancia) {
    return INSTANCIAS_CRITICAS.has(String(instancia || '').toLowerCase().trim());
}

/**
 * Envía un evento privado hacia Avisos Escolares (/api/internal/notificar)
 * de forma tolerante a fallos: nunca lanza excepciones hacia el flujo principal de GIE.
 */
export async function notificarEventoAvisos({
    evento,
    informe,
    alumno,
    autorNombre,
    fechaReunion = null,
}) {
    if (!AVISOS_INTERNAL_URL || AVISOS_INTERNAL_URL === 'disabled') {
        return { ok: false, skipped: true, reason: 'Puente a Avisos deshabilitado' };
    }

    const sufijoIdemp = fechaReunion || informe?.estado || 'evento';
    const payload = {
        sistema_origen: 'gie',
        evento,
        idempotency_key: `gie:${informe?.codigo || informe?.id}:${evento}:${sufijoIdemp}`,
        informe_codigo: informe?.codigo || String(informe?.id || ''),
        instancia: informe?.instancia || null,
        titulo: informe?.titulo || 'Notificación institucional',
        resumen: informe?.resumen || '',
        fecha_reunion: fechaReunion || null,
        autor_nombre: autorNombre || 'Equipo Directivo (GIE)',
        alumno: {
            nexus_id: alumno?.nexus_id || null,
            dni: alumno?.dni || null,
            nombre: alumno?.nombre || '',
            apellido: alumno?.apellido || '',
            curso: alumno?.curso
                ? `${alumno.curso}${alumno.division ? ` ${alumno.division}` : ''}`.trim()
                : '',
        },
    };

    try {
        const res = await fetch(AVISOS_INTERNAL_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-internal-key': INTERNAL_SERVICE_KEY,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(AVISOS_TIMEOUT_MS),
        });

        const text = await res.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch {
            json = { raw: text.slice(0, 200) };
        }

        if (!res.ok) {
            return {
                ok: false,
                status: res.status,
                error: json?.error || `Avisos respondió status ${res.status}`,
            };
        }

        return { ok: true, ...json };
    } catch (err) {
        console.warn('[AVISOS BRIDGE] Servicio Avisos no alcanzable:', err.message || err);
        return { ok: false, offline: true, error: err.message || String(err) };
    }
}

/**
 * Helper compartido por los endpoints de informes: resuelve datos del alumno,
 * despacha la notificación automática hacia Avisos y registra trazabilidad en historial_informes.
 */
export async function despacharNotificacionYAuditar({
    queryFn,
    evento,
    informe,
    alumnoId,
    user,
    fechaReunion = null,
}) {
    try {
        const alumnoRes = await queryFn(
            'SELECT nexus_id, dni, nombre, apellido, curso, division FROM alumnos WHERE id = $1 LIMIT 1',
            [alumnoId]
        );
        const alumno = alumnoRes.rows[0] || null;
        if (!alumno || (!alumno.dni && !alumno.nexus_id)) {
            return { ok: false, skipped: true, reason: 'Alumno sin DNI ni nexus_id para notificar' };
        }

        const autorNombre = user?.apellido && user?.nombre
            ? `${user.apellido}, ${user.nombre}`
            : (user?.email || 'Equipo Directivo GIE');

        const resultado = await notificarEventoAvisos({
            evento,
            informe,
            alumno,
            autorNombre,
            fechaReunion,
        });

        let detalleHistorial;
        if (resultado.ok) {
            detalleHistorial = resultado.deduplicated
                ? `Notificación (${evento}) ya registrada previamente en Avisos Escolares`
                : `Notificación (${evento}) despachada vía Avisos Escolares (${resultado.exitosos || 0}/${resultado.total || 0} correos, estado: ${resultado.estado || 'ok'})`;
        } else {
            detalleHistorial = `Notificación externa (${evento}) omitida: ${resultado.error || 'Avisos Escolares no disponible'}`;
        }

        await queryFn(
            `INSERT INTO historial_informes (informe_id, usuario_id, usuario_nombre, accion, detalle, motivo, fecha)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [
                informe.id,
                user.id,
                autorNombre,
                'notificacion_externa',
                detalleHistorial,
                'Disparo automático puente GIE -> Avisos Escolares',
            ]
        );

        return resultado;
    } catch (err) {
        console.warn('[AVISOS BRIDGE] Error en auditoría/despacho automático:', err.message || err);
        return { ok: false, error: err.message || String(err) };
    }
}
