import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_jwt_para_gie_onprem_segura';
const JWT_EXPIRES_IN = '7d';

export async function login(req, res, next) {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña requeridos' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const userRes = await query(
            'SELECT id, email, password_hash, nombre, apellido, rol, cursos, alumnos_pat, activo FROM usuarios WHERE email = $1',
            [normalizedEmail]
        );

        if (userRes.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const user = userRes.rows[0];

        if (!user.activo) {
            return res.status(403).json({ error: 'Cuenta de usuario desactivada' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const payload = {
            id: user.id,
            email: user.email,
            nombre: user.nombre,
            apellido: user.apellido,
            rol: user.rol,
            cursos: user.cursos || [],
            alumnos_pat: user.alumnos_pat || []
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        res.json({
            ok: true,
            token,
            user: payload
        });
    } catch (err) {
        next(err);
    }
}

export async function me(req, res, next) {
    try {
        const userRes = await query(
            'SELECT id, email, nombre, apellido, rol, cursos, alumnos_pat, activo FROM usuarios WHERE id = $1',
            [req.user.id]
        );

        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const user = userRes.rows[0];
        if (!user.activo) {
            return res.status(403).json({ error: 'Cuenta de usuario desactivada' });
        }

        res.json({
            ok: true,
            user: {
                id: user.id,
                email: user.email,
                nombre: user.nombre,
                apellido: user.apellido,
                rol: user.rol,
                cursos: user.cursos || [],
                alumnos_pat: user.alumnos_pat || []
            }
        });
    } catch (err) {
        next(err);
    }
}
