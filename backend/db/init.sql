-- ============================================================
-- GIE On-Premise - Esquema de Base de Datos PostgreSQL
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. TABLA DE USUARIOS PROPIOS DE GIE
CREATE TABLE IF NOT EXISTS usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nombre TEXT NOT NULL,
    apellido TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN (
        'regente', 'subregente', 'rector', 'vicerector',
        'docente', 'preceptor', 'doe', 'pat', 'jefe_de_taller'
    )),
    cursos JSONB NOT NULL DEFAULT '[]'::jsonb,
    alumnos_pat JSONB NOT NULL DEFAULT '[]'::jsonb,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_rol ON usuarios(rol);

-- 2. PADRÓN LOCAL DE ALUMNOS (Sincronizado desde Nexus vía API)
CREATE TABLE IF NOT EXISTS alumnos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nexus_id TEXT UNIQUE,
    dni INTEGER UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    apellido TEXT NOT NULL,
    curso TEXT NOT NULL,
    division TEXT NOT NULL,
    turno TEXT NOT NULL DEFAULT 'Mañana',
    especialidad TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alumnos_dni ON alumnos(dni);
CREATE INDEX IF NOT EXISTS idx_alumnos_apellido ON alumnos(apellido);
CREATE INDEX IF NOT EXISTS idx_alumnos_curso_division ON alumnos(curso, division);

-- 3. CATEGORÍAS DE INFORMES
CREATE TABLE IF NOT EXISTS categorias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL UNIQUE,
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

-- 4. PLANTILLAS DE INFORMES
CREATE TABLE IF NOT EXISTS plantillas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo TEXT NOT NULL,
    contenido TEXT NOT NULL,
    categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL,
    usos INTEGER NOT NULL DEFAULT 0,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. INFORMES PEDAGÓGICOS / DISCIPLINARIOS
CREATE TABLE IF NOT EXISTS informes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero SERIAL UNIQUE,
    codigo TEXT UNIQUE,
    alumno_id UUID NOT NULL REFERENCES alumnos(id) ON DELETE RESTRICT,
    categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL,
    creado_por UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    revisado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    derivado_a TEXT,
    tipo_falta TEXT NOT NULL,
    instancia TEXT NOT NULL CHECK (instancia IN ('leve', 'grave', 'muy_grave', 'consejo_aula', 'consejo')),
    titulo TEXT NOT NULL,
    resumen TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'revisado', 'archivado', 'derivado', 'anulado')),
    descargo TEXT,
    motivo_rechazo TEXT,
    motivo_anulacion TEXT,
    fecha_reunion DATE,
    fecha_revision TIMESTAMPTZ,
    observaciones TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_informes_alumno ON informes(alumno_id);
CREATE INDEX IF NOT EXISTS idx_informes_creado_por ON informes(creado_por);
CREATE INDEX IF NOT EXISTS idx_informes_estado ON informes(estado);
CREATE INDEX IF NOT EXISTS idx_informes_created_at ON informes(created_at DESC);

-- 6. HISTORIAL DE WORKFLOW DE INFORMES
CREATE TABLE IF NOT EXISTS historial_informes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    informe_id UUID NOT NULL REFERENCES informes(id) ON DELETE CASCADE,
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    usuario_nombre TEXT,
    accion TEXT,
    detalle TEXT,
    estado_anterior TEXT,
    estado_nuevo TEXT,
    motivo TEXT,
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historial_informe ON historial_informes(informe_id);

-- 7. OBSERVACIONES Y SEGUIMIENTOS DE ALUMNOS
CREATE TABLE IF NOT EXISTS observaciones_alumno (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alumno_id UUID NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
    autor_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    tipo TEXT NOT NULL,
    titulo TEXT NOT NULL,
    contenido TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_obs_alumno ON observaciones_alumno(alumno_id);

-- 8. TIPOS DE OBSERVACIÓN PERSONALIZABLES
CREATE TABLE IF NOT EXISTS tipos_observacion_alumno (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE
);
