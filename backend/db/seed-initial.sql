-- ============================================================
-- GIE On-Premise - Datos Iniciales (Seed)
-- ============================================================

-- 1. USUARIOS INICIALES (Contraseña por defecto: 123asd / asd123)
INSERT INTO usuarios (email, password_hash, nombre, apellido, rol, activo)
VALUES
    ('admin@gie.com', crypt('123asd', gen_salt('bf', 10)), 'Administrador', 'General', 'regente', true),
    ('regente@gie.com', crypt('123asd', gen_salt('bf', 10)), 'Regente', 'Principal', 'regente', true),
    ('docente@gie.com', crypt('asd123', gen_salt('bf', 10)), 'Docente', 'Prueba', 'docente', true),
    ('doe@gie.com', crypt('123asd', gen_salt('bf', 10)), 'Orientador', 'DOE', 'doe', true),
    ('pat@gie.com', crypt('asd123', gen_salt('bf', 10)), 'Tutor', 'PAT', 'pat', true)
ON CONFLICT (email) DO NOTHING;

-- 2. CATEGORÍAS POR DEFECTO
INSERT INTO categorias (nombre, activo)
VALUES
    ('Conducta', true),
    ('Rendimiento Académico', true),
    ('Asistencia y Puntualidad', true),
    ('Convivencia Escolar', true),
    ('Seguridad en Taller', true)
ON CONFLICT (nombre) DO NOTHING;

-- 3. TIPOS DE OBSERVACIÓN
INSERT INTO tipos_observacion_alumno (nombre, color, activo)
VALUES
    ('Entrevista', '#3b82f6', true),
    ('Llamado a Padres', '#f59e0b', true),
    ('Derivación DOE', '#8b5cf6', true),
    ('Sanción Disciplinaria', '#ef4444', true),
    ('Seguimiento Pedagógico', '#10b981', true)
ON CONFLICT (nombre) DO NOTHING;
