import { query } from '../config/db.js';
import { esRegente } from '../middlewares/authMiddleware.js';

export async function listarInformes(req, res, next) {
    try {
        const { rol, id: userId, alumnos_pat } = req.user;
        const { estado, instancia, curso, division, alumno_id } = req.query;

        let sql = `
            SELECT 
                i.id, i.numero, i.codigo, i.alumno_id, i.categoria_id, i.creado_por, i.revisado_por,
                i.derivado_a, i.tipo_falta, i.instancia, i.titulo, i.resumen, i.estado,
                i.descargo, i.motivo_rechazo, i.motivo_anulacion, i.fecha_reunion, i.observaciones,
                i.created_at, i.updated_at, i.created_at AS fecha_creacion, i.updated_at AS fecha_revision,
                json_build_object(
                    'id', a.id, 'nombre', a.nombre, 'apellido', a.apellido,
                    'curso', a.curso, 'division', a.division, 'turno', a.turno, 'dni', a.dni
                ) AS alumno,
                json_build_object('id', c.id, 'nombre', c.nombre) AS categoria,
                json_build_object('id', u.id, 'nombre', u.nombre, 'apellido', u.apellido) AS creador,
                json_build_object('id', r.id, 'nombre', r.nombre, 'apellido', r.apellido) AS revisor
            FROM informes i
            JOIN alumnos a ON a.id = i.alumno_id
            LEFT JOIN categorias c ON c.id = i.categoria_id
            LEFT JOIN usuarios u ON u.id = i.creado_por
            LEFT JOIN usuarios r ON r.id = i.revisado_por
            WHERE 1=1
        `;

        const params = [];

        // Filtro por rol institucional
        if (esRegente(rol)) {
            // Regente ve todo
        } else if (rol === 'doe') {
            // DOE ve derivados, archivados y anulados
            params.push(['derivado', 'archivado', 'anulado']);
            sql += ` AND i.estado = ANY($${params.length})`;
        } else if (rol === 'pat') {
            // PAT ve alumnos asignados
            const asignados = Array.isArray(alumnos_pat) ? alumnos_pat : [];
            params.push(asignados);
            sql += ` AND i.alumno_id = ANY($${params.length}::uuid[])`;
        } else {
            // Docente / Preceptor ve sus propios informes
            params.push(userId);
            sql += ` AND i.creado_por = $${params.length}`;
        }

        // Filtros opcionales por query param
        if (estado) {
            params.push(estado);
            sql += ` AND i.estado = $${params.length}`;
        }
        if (instancia) {
            params.push(instancia);
            sql += ` AND i.instancia = $${params.length}`;
        }
        if (alumno_id) {
            params.push(alumno_id);
            sql += ` AND i.alumno_id = $${params.length}`;
        }
        if (curso) {
            params.push(curso);
            sql += ` AND a.curso = $${params.length}`;
        }
        if (division) {
            params.push(division);
            sql += ` AND a.division = $${params.length}`;
        }

        sql += ` ORDER BY i.created_at DESC`;

        const { rows } = await query(sql, params);
        res.json({ ok: true, data: rows });
    } catch (err) {
        next(err);
    }
}

export async function obtenerInforme(req, res, next) {
    try {
        const { id } = req.params;

        const infoSql = `
            SELECT 
                i.*,
                json_build_object(
                    'id', a.id, 'nombre', a.nombre, 'apellido', a.apellido,
                    'curso', a.curso, 'division', a.division, 'turno', a.turno, 'dni', a.dni
                ) AS alumno,
                json_build_object('id', c.id, 'nombre', c.nombre) AS categoria,
                json_build_object('id', u.id, 'nombre', u.nombre, 'apellido', u.apellido) AS creador,
                json_build_object('id', r.id, 'nombre', r.nombre, 'apellido', r.apellido) AS revisor
            FROM informes i
            JOIN alumnos a ON a.id = i.alumno_id
            LEFT JOIN categorias c ON c.id = i.categoria_id
            LEFT JOIN usuarios u ON u.id = i.creado_por
            LEFT JOIN usuarios r ON r.id = i.revisado_por
            WHERE i.id = $1
        `;

        const { rows } = await query(infoSql, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Informe no encontrado' });
        }

        const histSql = `
            SELECT h.*, json_build_object('id', u.id, 'nombre', u.nombre, 'apellido', u.apellido, 'rol', u.rol) AS usuario
            FROM historial_informes h
            LEFT JOIN usuarios u ON u.id = h.usuario_id
            WHERE h.informe_id = $1
            ORDER BY h.created_at ASC
        `;
        const histRes = await query(histSql, [id]);

        res.json({
            ok: true,
            data: {
                ...rows[0],
                historial: histRes.rows
            }
        });
    } catch (err) {
        next(err);
    }
}

export async function crearInforme(req, res, next) {
    try {
        const {
            alumno_id, categoria_id, tipo_falta, instancia,
            titulo, resumen, descargo, fecha_reunion, observaciones
        } = req.body;

        if (!alumno_id || !tipo_falta || !instancia || !titulo || !resumen) {
            return res.status(400).json({ error: 'Faltan campos obligatorios para el informe' });
        }

        // Generar correlativo anual
        const anioActual = new Date().getFullYear();

        const insertSql = `
            INSERT INTO informes (
                alumno_id, categoria_id, creado_por, tipo_falta, instancia,
                titulo, resumen, descargo, fecha_reunion, observaciones, estado
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pendiente')
            RETURNING id, numero, created_at
        `;

        const values = [
            alumno_id,
            categoria_id || null,
            req.user.id,
            tipo_falta,
            instancia,
            titulo,
            resumen,
            descargo || null,
            fecha_reunion || null,
            observaciones || null
        ];

        const { rows } = await query(insertSql, values);
        const nuevo = rows[0];

        // Código YYYY-XXXX
        const codigo = `${anioActual}-${String(nuevo.numero).padStart(4, '0')}`;
        await query('UPDATE informes SET codigo = $1 WHERE id = $2', [codigo, nuevo.id]);

        // Registrar en historial
        await query(
            'INSERT INTO historial_informes (informe_id, usuario_id, estado_anterior, estado_nuevo, motivo) VALUES ($1, $2, NULL, $3, $4)',
            [nuevo.id, req.user.id, 'pendiente', 'Informe redactado y enviado a revisión inicial']
        );

        res.status(201).json({
            ok: true,
            data: { id: nuevo.id, numero: nuevo.numero, codigo }
        });
    } catch (err) {
        next(err);
    }
}

export async function actualizarInforme(req, res, next) {
    try {
        const { id } = req.params;
        const { rol, id: userId } = req.user;

        // Comprobar existencia y permisos
        const check = await query('SELECT creado_por, estado FROM informes WHERE id = $1', [id]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Informe no encontrado' });
        }

        const actual = check.rows[0];
        const puedeEditar = esRegente(rol) || (actual.creado_por === userId && ['pendiente', 'anulado'].includes(actual.estado));

        if (!puedeEditar) {
            return res.status(403).json({ error: 'No tenés permisos para modificar este informe' });
        }

        const {
            categoria_id, tipo_falta, instancia, titulo, resumen, descargo, observaciones, fecha_reunion
        } = req.body;

        const updateSql = `
            UPDATE informes SET
                categoria_id = COALESCE($1, categoria_id),
                tipo_falta = COALESCE($2, tipo_falta),
                instancia = COALESCE($3, instancia),
                titulo = COALESCE($4, titulo),
                resumen = COALESCE($5, resumen),
                descargo = $6,
                observaciones = $7,
                fecha_reunion = $8,
                updated_at = NOW()
            WHERE id = $9
            RETURNING id, codigo, estado, updated_at
        `;

        const { rows } = await query(updateSql, [
            categoria_id || null, tipo_falta, instancia, titulo, resumen,
            descargo || null, observaciones || null, fecha_reunion || null, id
        ]);

        res.json({ ok: true, data: rows[0] });
    } catch (err) {
        next(err);
    }
}

export async function cambiarEstado(req, res, next) {
    try {
        const { id } = req.params;
        const { nuevo_estado, motivo, derivado_a } = req.body;
        const { rol, id: userId } = req.user;

        const check = await query('SELECT estado FROM informes WHERE id = $1', [id]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Informe no encontrado' });
        }

        const estadoAnterior = check.rows[0].estado;

        // Validación de permisos según transición
        if (nuevo_estado === 'pendiente') {
            // DOE o Regente pueden devolver informe derivado a pendiente
            if (!esRegente(rol) && rol !== 'doe') {
                return res.status(403).json({ error: 'Solo DOE o directivos pueden devolver un informe a pendiente' });
            }
        } else {
            // Solo directivos pueden aprobar, derivar, archivar o anular
            if (!esRegente(rol)) {
                return res.status(403).json({ error: 'Solo directivos pueden modificar el estado formal de un informe' });
            }
        }

        let updateSql = `
            UPDATE informes SET
                estado = $1,
                revisado_por = $2,
                updated_at = NOW()
        `;
        const params = [nuevo_estado, userId];

        if (nuevo_estado === 'derivado' && derivado_a) {
            params.push(derivado_a);
            updateSql += `, derivado_a = $${params.length}`;
        }
        if (nuevo_estado === 'anulado' && motivo) {
            params.push(motivo);
            updateSql += `, motivo_anulacion = $${params.length}`;
        }

        params.push(id);
        updateSql += ` WHERE id = $${params.length} RETURNING id, estado, codigo, updated_at`;

        const { rows } = await query(updateSql, params);

        // Registro en historial
        await query(
            'INSERT INTO historial_informes (informe_id, usuario_id, estado_anterior, estado_nuevo, motivo) VALUES ($1, $2, $3, $4, $5)',
            [id, userId, estadoAnterior, nuevo_estado, motivo || `Transición a ${nuevo_estado}`]
        );

        res.json({ ok: true, data: rows[0] });
    } catch (err) {
        next(err);
    }
}
