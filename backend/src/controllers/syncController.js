import { query } from '../config/db.js';
import { fetchCursosYNexusAlumnos } from '../services/nexusClient.js';

function normalizeTurno(val) {
    const v = String(val || 'Mañana').trim().toLowerCase();
    if (v === 'tarde') return 'Tarde';
    if (v === 'noche') return 'Noche';
    return 'Mañana';
}

export async function sincronizarAlumnos(req, res, next) {
    try {
        console.log('[SYNC] Iniciando sincronización de alumnos desde Nexus Gateway...');
        const { cursos, alumnos } = await fetchCursosYNexusAlumnos();

        if (!alumnos || alumnos.length === 0) {
            return res.json({ ok: true, sincronizados: 0, mensaje: 'No se encontraron alumnos en Nexus' });
        }

        const mapaCursos = new Map();
        for (const c of (cursos || [])) {
            const id = c.id_curso || c.id;
            if (id) {
                mapaCursos.set(Number(id), c);
            }
        }

        // Obtener padrón actual de GIE
        const actualesRes = await query('SELECT id, dni, nexus_id, activo FROM alumnos');
        const mapaActualesPorDni = new Map(actualesRes.rows.map(a => [Number(a.dni), a]));

        let insertados = 0;
        let actualizados = 0;
        let reactivados = 0;

        const dnisEnNexus = new Set();

        for (const na of alumnos) {
            if (!na.dni) continue;
            const dniNum = Number(na.dni);
            dnisEnNexus.add(dniNum);

            const nombre = String(na.nombre || '').trim();
            const apellido = String(na.apellido || '').trim();
            if (!nombre || !apellido) continue;

            const cursoInfo = na.id_curso ? mapaCursos.get(Number(na.id_curso)) : null;
            const cursoStr = cursoInfo?.anio ? `${cursoInfo.anio}°` : (cursoInfo?.division || 'Sin curso');
            const divisionStr = cursoInfo?.division || 'U';
            const turnoStr = normalizeTurno(cursoInfo?.turno);
            const especialidadStr = cursoInfo?.especialidad || 'Sin especialidad';

            const existente = mapaActualesPorDni.get(dniNum);

            if (existente) {
                const reactivar = existente.activo === false;
                await query(
                    `UPDATE alumnos SET
                        nexus_id = $1,
                        nombre = $2,
                        apellido = $3,
                        curso = $4,
                        division = $5,
                        turno = $6,
                        especialidad = $7,
                        activo = TRUE,
                        synced_at = NOW()
                    WHERE id = $8`,
                    [na.id || null, nombre, apellido, cursoStr, divisionStr, turnoStr, especialidadStr, existente.id]
                );
                actualizados++;
                if (reactivar) reactivados++;
            } else {
                await query(
                    `INSERT INTO alumnos (nexus_id, dni, nombre, apellido, curso, division, turno, especialidad, activo, synced_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, NOW())`,
                    [na.id || null, dniNum, nombre, apellido, cursoStr, divisionStr, turnoStr, especialidadStr]
                );
                insertados++;
            }
        }

        // Soft-delete: desactivar alumnos que ya no figuran en Nexus
        let desactivados = 0;
        for (const [dniActual, alumnoActual] of mapaActualesPorDni.entries()) {
            if (alumnoActual.activo && !dnisEnNexus.has(dniActual)) {
                await query('UPDATE alumnos SET activo = FALSE, synced_at = NOW() WHERE id = $1', [alumnoActual.id]);
                desactivados++;
            }
        }

        console.log(`[SYNC] Completada: ${insertados} insertados, ${actualizados} actualizados (${reactivados} reactivados), ${desactivados} desactivados.`);

        res.json({
            ok: true,
            sincronizados: alumnos.length,
            insertados,
            actualizados,
            reactivados,
            desactivados
        });
    } catch (err) {
        console.error('[SYNC] Error en sincronización con Nexus:', err);
        next(err);
    }
}
