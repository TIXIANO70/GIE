import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_jwt_para_gie_onprem_segura';

export const DIRECTIVE_ROLES = ['regente', 'subregente', 'rector', 'vicerector', 'jefe_de_taller'];

export function esRegente(rol) {
    return DIRECTIVE_ROLES.includes(rol);
}

export function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de autorización requerido' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
}

export function requireRole(...rolesPermitidos) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuario no autenticado' });
        }

        // Si se pide 'regente', cualquier directivo califica
        const tienePermiso = rolesPermitidos.some(r => {
            if (r === 'regente') return esRegente(req.user.rol);
            return req.user.rol === r;
        });

        if (!tienePermiso) {
            return res.status(403).json({ error: 'Acceso denegado: permisos insuficientes' });
        }

        next();
    };
}
