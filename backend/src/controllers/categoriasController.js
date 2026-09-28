import { query } from '../config/db.js';

export async function listarCategorias(req, res, next) {
    try {
        const { rows } = await query('SELECT * FROM categorias WHERE activo = TRUE ORDER BY nombre');
        res.json({ ok: true, data: rows });
    } catch (err) {
        next(err);
    }
}

export async function crearCategoria(req, res, next) {
    try {
        const { nombre } = req.body;
        if (!nombre || !nombre.trim()) {
            return res.status(400).json({ error: 'Nombre de categoría requerido' });
        }
        const { rows } = await query(
            'INSERT INTO categorias (nombre, activo) VALUES ($1, TRUE) ON CONFLICT (nombre) DO UPDATE SET activo = TRUE RETURNING *',
            [nombre.trim()]
        );
        res.status(201).json({ ok: true, data: rows[0] });
    } catch (err) {
        next(err);
    }
}

export async function eliminarCategoria(req, res, next) {
    try {
        const { id } = req.params;
        await query('UPDATE categorias SET activo = FALSE WHERE id = $1', [id]);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
}

export async function listarPlantillas(req, res, next) {
    try {
        const sql = `
            SELECT p.*, json_build_object('id', c.id, 'nombre', c.nombre) AS categoria
            FROM plantillas p
            LEFT JOIN categorias c ON c.id = p.categoria_id
            WHERE p.activo = TRUE
            ORDER BY p.usos DESC, p.created_at DESC
        `;
        const { rows } = await query(sql);
        res.json({ ok: true, data: rows });
    } catch (err) {
        next(err);
    }
}

export async function crearPlantilla(req, res, next) {
    try {
        const { titulo, contenido, categoria_id } = req.body;
        if (!titulo || !contenido) {
            return res.status(400).json({ error: 'Título y contenido requeridos' });
        }
        const { rows } = await query(
            'INSERT INTO plantillas (titulo, contenido, categoria_id) VALUES ($1, $2, $3) RETURNING *',
            [titulo.trim(), contenido.trim(), categoria_id || null]
        );
        res.status(201).json({ ok: true, data: rows[0] });
    } catch (err) {
        next(err);
    }
}

export async function eliminarPlantilla(req, res, next) {
    try {
        const { id } = req.params;
        await query('UPDATE plantillas SET activo = FALSE WHERE id = $1', [id]);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
}

export async function usarPlantilla(req, res, next) {
    try {
        const { id } = req.params;
        await query('UPDATE plantillas SET usos = usos + 1 WHERE id = $1', [id]);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
}
