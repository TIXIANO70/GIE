import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { esRegente } from '../middlewares/authMiddleware.js';

export async function listarUsuarios(req, res, next) {
    try {
        const { rows } = await query(
            'SELECT id, email, nombre, apellido, rol, cursos, alumnos_pat, activo, created_at FROM usuarios ORDER BY apellido, nombre'
        );
        res.json({ ok: true, data: rows });
    } catch (err) {
        next(err);
    }
}

export async function crearUsuario(req, res, next) {
    try {
        const { email, password, nombre, apellido, rol, cursos, alumnos_pat } = req.body;
        if (!email || !password || !nombre || !apellido || !rol) {
            return res.status(400).json({ error: 'Faltan campos obligatorios para dar de alta al usuario' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const existe = await query('SELECT id FROM usuarios WHERE email = $1', [normalizedEmail]);
        if (existe.rows.length > 0) {
            return res.status(409).json({ error: 'El email ya está registrado' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const { rows } = await query(
            `INSERT INTO usuarios (email, password_hash, nombre, apellido, rol, cursos, alumnos_pat, activo)
             VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
             RETURNING id, email, nombre, apellido, rol, cursos, alumnos_pat, activo`,
            [normalizedEmail, passwordHash, nombre.trim(), apellido.trim(), rol, JSON.stringify(cursos || []), JSON.stringify(alumnos_pat || [])]
        );

        res.status(201).json({ ok: true, data: rows[0] });
    } catch (err) {
        next(err);
    }
}

export async function actualizarUsuario(req, res, next) {
    try {
        const { id } = req.params;
        const { nombre, apellido, rol, cursos, alumnos_pat, activo } = req.body;

        const updateSql = `
            UPDATE usuarios SET
                nombre = COALESCE($1, nombre),
                apellido = COALESCE($2, apellido),
                rol = COALESCE($3, rol),
                cursos = COALESCE($4::jsonb, cursos),
                alumnos_pat = COALESCE($5::jsonb, alumnos_pat),
                activo = COALESCE($6, activo),
                updated_at = NOW()
            WHERE id = $7
            RETURNING id, email, nombre, apellido, rol, cursos, alumnos_pat, activo
        `;

        const { rows } = await query(updateSql, [
            nombre?.trim() || null,
            apellido?.trim() || null,
            rol || null,
            cursos ? JSON.stringify(cursos) : null,
            alumnos_pat ? JSON.stringify(alumnos_pat) : null,
            typeof activo === 'boolean' ? activo : null,
            id
        ]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ ok: true, data: rows[0] });
    } catch (err) {
        next(err);
    }
}

export async function cambiarPassword(req, res, next) {
    try {
        const { id } = req.params;
        const { new_password } = req.body;

        if (!new_password || new_password.length < 6) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
        }

        // Solo el propio usuario o un regente puede cambiar la contraseña
        if (req.user.id !== id && !esRegente(req.user.rol)) {
            return res.status(403).json({ error: 'No tenés permisos para cambiar la contraseña de otro usuario' });
        }

        const passwordHash = await bcrypt.hash(new_password, 10);
        await query('UPDATE usuarios SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, id]);

        res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' });
    } catch (err) {
        next(err);
    }
}
