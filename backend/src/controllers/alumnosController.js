import { query } from '../config/db.js';

export async function listarAlumnos(req, res, next) {
    try {
        const { search, curso, division, turno, solo_activos } = req.query;

        let sql = `
            SELECT id, nexus_id, dni, nombre, apellido, curso, division, turno, especialidad, activo, synced_at
            FROM alumnos
            WHERE 1=1
        `;
        const params = [];

        if (solo_activos !== 'false') {
            sql += ` AND activo = TRUE`;
        }

        if (curso) {
            params.push(curso);
            sql += ` AND curso = $${params.length}`;
        }

        if (division) {
            params.push(division);
            sql += ` AND division = $${params.length}`;
        }

        if (turno) {
            params.push(turno);
            sql += ` AND turno = $${params.length}`;
        }

        if (search) {
            params.push(`%${search.trim().toLowerCase()}%`);
            sql += ` AND (LOWER(nombre) LIKE $${params.length} OR LOWER(apellido) LIKE $${params.length} OR CAST(dni AS TEXT) LIKE $${params.length})`;
        }

        sql += ` ORDER BY apellido ASC, nombre ASC`;

        const { rows } = await query(sql, params);
        res.json({ ok: true, data: rows });
    } catch (err) {
        next(err);
    }
}

export async function obtenerAlumno(req, res, next) {
    try {
        const { id } = req.params;

        const alumnoRes = await query('SELECT * FROM alumnos WHERE id = $1', [id]);
        if (alumnoRes.rows.length === 0) {
            return res.status(404).json({ error: 'Alumno no encontrado' });
        }
        const alumno = alumnoRes.rows[0];

        // Observaciones
        const obsSql = `
            SELECT o.*, json_build_object('id', u.id, 'nombre', u.nombre, 'apellido', u.apellido) AS autor
            FROM observaciones_alumno o
            JOIN usuarios u ON u.id = o.autor_id
            WHERE o.alumno_id = $1
            ORDER BY o.created_at DESC
        `;
        const obsRes = await query(obsSql, [id]);

        // Estadísticas de informes
        const statsSql = `
            SELECT 
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE instancia = 'leve')::int AS leves,
                COUNT(*) FILTER (WHERE instancia = 'grave')::int AS graves,
                COUNT(*) FILTER (WHERE instancia = 'muy_grave')::int AS muy_graves,
                COUNT(*) FILTER (WHERE instancia = 'consejo_aula')::int AS consejo_aula,
                COUNT(*) FILTER (WHERE instancia = 'consejo')::int AS consejo
            FROM informes
            WHERE alumno_id = $1
        `;
        const statsRes = await query(statsSql, [id]);

        res.json({
            ok: true,
            data: {
                ...alumno,
                observaciones: obsRes.rows,
                stats: statsRes.rows[0]
            }
        });
    } catch (err) {
        next(err);
    }
}

export async function crearObservacion(req, res, next) {
    try {
        const { id: alumnoId } = req.params;
        const { tipo, titulo, contenido } = req.body;

        if (!tipo || !titulo || !contenido) {
            return res.status(400).json({ error: 'Faltan campos para registrar la observación' });
        }

        const sql = `
            INSERT INTO observaciones_alumno (alumno_id, autor_id, tipo, titulo, contenido)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, tipo, titulo, contenido, created_at
        `;

        const { rows } = await query(sql, [alumnoId, req.user.id, tipo, titulo, contenido]);
        res.status(201).json({ ok: true, data: rows[0] });
    } catch (err) {
        next(err);
    }
}

export async function eliminarObservacion(req, res, next) {
    try {
        const { obsId } = req.params;
        await query('DELETE FROM observaciones_alumno WHERE id = $1', [obsId]);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
}

export async function listarTiposObservacion(req, res, next) {
    try {
        const { rows } = await query('SELECT * FROM tipos_observacion_alumno WHERE activo = TRUE ORDER BY nombre');
        res.json({ ok: true, data: rows });
    } catch (err) {
        next(err);
    }
}
