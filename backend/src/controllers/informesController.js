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

        // Filtro por rol institucional (incluyendo derivación a usuario específico)
        if (esRegente(rol)) {
            // Regente ve todo
        } else if (rol === 'doe') {
            // DOE ve derivados, archivados y anulados O los informes derivados directamente a él
            params.push(['derivado', 'archivado', 'anulado']);
            const estadoIdx = `$${params.length}`;
            params.push(String(userId));
            const userIdx = `$${params.length}`;
            params.push(String(req.user.email || ''));
            const emailIdx = `$${params.length}`;
            sql += ` AND (i.estado = ANY(${estadoIdx}) OR i.derivado_a = ${userIdx} OR i.derivado_a = ${emailIdx})`;
        } else if (rol === 'pat') {
            // PAT ve alumnos asignados O los informes derivados directamente a él
            const asignados = Array.isArray(alumnos_pat) ? alumnos_pat : [];
            params.push(asignados);
            const alumnosIdx = `$${params.length}::uuid[]`;
            params.push(String(userId));
            const userIdx = `$${params.length}`;
            params.push(String(req.user.email || ''));
            const emailIdx = `$${params.length}`;
            sql += ` AND (i.alumno_id = ANY(${alumnosIdx}) OR i.derivado_a = ${userIdx} OR i.derivado_a = ${emailIdx})`;
        } else {
            // Docente / Preceptor ve sus propios informes O los informes derivados directamente a él
            params.push(userId);
            const creadorIdx = `$${params.length}`;
            params.push(String(userId));
            const userIdx = `$${params.length}`;
            params.push(String(req.user.email || ''));
            const emailIdx = `$${params.length}`;
            sql += ` AND (i.creado_por = ${creadorIdx} OR i.derivado_a = ${userIdx} OR i.derivado_a = ${emailIdx})`;
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
        const { rol, id: userId, email: userEmail } = req.user;

        const check = await query('SELECT creado_por, estado, derivado_a FROM informes WHERE id = $1', [id]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Informe no encontrado' });
        }

        const actual = check.rows[0];
        const esDestinatario = actual.derivado_a && (actual.derivado_a === String(userId) || actual.derivado_a === userEmail);
        const {
            categoria_id, tipo_falta, instancia, titulo, resumen, descargo, observaciones,
            fecha_reunion, estado, revisado_por, fecha_revision, motivo_rechazo, motivo_anulacion, derivado_a
        } = req.body;

        if (estado && estado !== actual.estado) {
            if (estado === 'pendiente') {
                if (!esRegente(rol) && rol !== 'doe' && !esDestinatario) {
                    return res.status(403).json({ error: 'Solo DOE, directivos o destinatario de la derivación pueden devolver un informe a pendiente' });
                }
            } else if (!esRegente(rol)) {
                return res.status(403).json({ error: 'Solo directivos pueden modificar el estado del informe' });
            }
        } else {
            const puedeEditar = esRegente(rol) || esDestinatario || (actual.creado_por === userId && ['pendiente', 'anulado'].includes(actual.estado));
            if (!puedeEditar) {
                return res.status(403).json({ error: 'No tenés permisos para modificar este informe' });
            }
        }

        const updateSql = `
            UPDATE informes SET
                categoria_id = COALESCE($1, categoria_id),
                tipo_falta = COALESCE($2, tipo_falta),
                instancia = COALESCE($3, instancia),
                titulo = COALESCE($4, titulo),
                resumen = COALESCE($5, resumen),
                descargo = COALESCE($6, descargo),
                observaciones = COALESCE($7, observaciones),
                fecha_reunion = CASE WHEN $8 = 'NULL' THEN NULL WHEN $8 IS NOT NULL THEN $8::date ELSE fecha_reunion END,
                estado = COALESCE($9, estado),
                revisado_por = COALESCE($10, revisado_por),
                fecha_revision = COALESCE($11, fecha_revision),
                motivo_rechazo = COALESCE($12, motivo_rechazo),
                motivo_anulacion = COALESCE($13, motivo_anulacion),
                derivado_a = COALESCE($14, derivado_a),
                updated_at = NOW()
            WHERE id = $15
            RETURNING id, codigo, estado, revisado_por, fecha_revision, updated_at
        `;

        const fechaReunionParam = fecha_reunion === null ? 'NULL' : (fecha_reunion || null);

        const { rows } = await query(updateSql, [
            categoria_id || null, tipo_falta || null, instancia || null, titulo || null, resumen || null,
            descargo || null, observaciones || null, fechaReunionParam,
            estado || null, revisado_por || null, fecha_revision || null,
            motivo_rechazo || null, motivo_anulacion || null, derivado_a || null,
            id
        ]);

        if (estado && estado !== actual.estado) {
            await query(
                'INSERT INTO historial_informes (informe_id, usuario_id, usuario_nombre, accion, detalle, estado_anterior, estado_nuevo, motivo, fecha) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())',
                [id, userId, `${req.user.apellido}, ${req.user.nombre}`, 'revision', `Informe ${estado} por ${req.user.apellido}, ${req.user.nombre}`, actual.estado, estado, motivo_rechazo || motivo_anulacion || `Transición a ${estado}`]
            );
        }

        res.json({ ok: true, data: rows[0] });
    } catch (err) {
        next(err);
    }
}

export async function cambiarEstado(req, res, next) {
    try {
        const { id } = req.params;
        const { nuevo_estado, motivo, derivado_a } = req.body;
        const { rol, id: userId, email: userEmail } = req.user;

        const check = await query('SELECT estado, derivado_a FROM informes WHERE id = $1', [id]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Informe no encontrado' });
        }

        const actual = check.rows[0];
        const estadoAnterior = actual.estado;
        const esDestinatario = actual.derivado_a && (actual.derivado_a === String(userId) || actual.derivado_a === userEmail);

        // Validación de permisos según transición
        if (nuevo_estado === 'pendiente') {
            // DOE, directivos o destinatario de la derivación pueden devolver informe derivado a pendiente
            if (!esRegente(rol) && rol !== 'doe' && !esDestinatario) {
                return res.status(403).json({ error: 'Solo DOE, directivos o destinatario de la derivación pueden devolver un informe a pendiente' });
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

export async function agregarHistorial(req, res, next) {
    try {
        const { id } = req.params;
        const { accion, detalle, motivo } = req.body;
        const usuario_id = req.user.id;
        const usuario_nombre = `${req.user.apellido}, ${req.user.nombre}`;
        const { rol, email: userEmail } = req.user;

        const check = await query('SELECT id, creado_por, derivado_a, estado FROM informes WHERE id = $1', [id]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Informe no encontrado' });
        }

        const actual = check.rows[0];
        const esDestinatario = actual.derivado_a && (actual.derivado_a === String(usuario_id) || actual.derivado_a === userEmail);
        const esCreador = actual.creado_por === usuario_id;
        const esDirector = esRegente(rol);
        const esDoeOPat = rol === 'doe' || rol === 'pat';

        if (!esDirector && !esDoeOPat && !esCreador && !esDestinatario) {
            return res.status(403).json({ error: 'No tenés permisos para registrar acciones en este informe' });
        }

        const insertSql = `
            INSERT INTO historial_informes (informe_id, usuario_id, usuario_nombre, accion, detalle, motivo, fecha)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING *
        `;
        const { rows } = await query(insertSql, [id, usuario_id, usuario_nombre, accion || 'observaciones', detalle || motivo, motivo]);
        res.status(201).json({ ok: true, data: rows[0] });
    } catch (err) {
        next(err);
    }
}

export const agregarObservacion = agregarHistorial;
export const registrarAccionTomada = agregarHistorial;

export async function listarHistorial(req, res, next) {
    try {
        const { id } = req.params;
        const histSql = `
            SELECT h.*, json_build_object('id', u.id, 'nombre', u.nombre, 'apellido', u.apellido, 'rol', u.rol) AS usuario
            FROM historial_informes h
            LEFT JOIN usuarios u ON u.id = h.usuario_id
            WHERE h.informe_id = $1
            ORDER BY COALESCE(h.fecha, h.created_at) ASC
        `;
        const { rows } = await query(histSql, [id]);
        res.json({ ok: true, data: rows });
    } catch (err) {
        next(err);
    }
}

