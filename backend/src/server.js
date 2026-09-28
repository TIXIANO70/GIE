import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { errorHandler } from './middlewares/errorHandler.js';
import { authMiddleware, requireRole } from './middlewares/authMiddleware.js';

import * as authCtrl from './controllers/authController.js';
import * as informesCtrl from './controllers/informesController.js';
import * as alumnosCtrl from './controllers/alumnosController.js';
import * as syncCtrl from './controllers/syncController.js';
import * as categoriasCtrl from './controllers/categoriasController.js';
import * as usuariosCtrl from './controllers/usuariosController.js';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

// Healthcheck
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'gie-backend-onprem',
        timestamp: new Date().toISOString()
    });
});

// Rutas de Autenticación
app.post('/api/auth/login', authCtrl.login);
app.get('/api/auth/me', authMiddleware, authCtrl.me);

// Rutas de Informes
app.get('/api/informes', authMiddleware, informesCtrl.listarInformes);
app.get('/api/informes/:id', authMiddleware, informesCtrl.obtenerInforme);
app.post('/api/informes', authMiddleware, informesCtrl.crearInforme);
app.put('/api/informes/:id', authMiddleware, informesCtrl.actualizarInforme);
app.put('/api/informes/:id/estado', authMiddleware, informesCtrl.cambiarEstado);
app.get('/api/informes/:id/historial', authMiddleware, informesCtrl.listarHistorial);
app.post('/api/informes/:id/historial', authMiddleware, informesCtrl.agregarHistorial);

// Rutas de Alumnos
app.get('/api/alumnos', authMiddleware, alumnosCtrl.listarAlumnos);
app.get('/api/alumnos/tipos-observacion', authMiddleware, alumnosCtrl.listarTiposObservacion);
app.get('/api/alumnos/:id', authMiddleware, alumnosCtrl.obtenerAlumno);
app.post('/api/alumnos/:id/observaciones', authMiddleware, alumnosCtrl.crearObservacion);
app.delete('/api/alumnos/observaciones/:obsId', authMiddleware, alumnosCtrl.eliminarObservacion);

// Sincronización con Nexus Gateway
app.post('/api/alumnos/sync', authMiddleware, requireRole('regente'), syncCtrl.sincronizarAlumnos);
app.post('/api/functions/v1/sync-alumnos-nexus', authMiddleware, requireRole('regente'), syncCtrl.sincronizarAlumnos);

// Funciones de gestión de usuarios (compatibilidad)
app.post('/api/functions/v1/crear-usuario', authMiddleware, requireRole('regente'), usuariosCtrl.crearUsuario);
app.post('/api/functions/v1/actualizar-password', authMiddleware, (req, res, next) => {
    // Si la llamada viene con { user_id, new_password }, mapear params
    if (req.body.user_id && !req.params.id) {
        req.params.id = req.body.user_id;
    }
    return usuariosCtrl.cambiarPassword(req, res, next);
});

// Categorías y Plantillas
app.get('/api/categorias', authMiddleware, categoriasCtrl.listarCategorias);
app.post('/api/categorias', authMiddleware, requireRole('regente'), categoriasCtrl.crearCategoria);
app.delete('/api/categorias/:id', authMiddleware, requireRole('regente'), categoriasCtrl.eliminarCategoria);

app.get('/api/plantillas', authMiddleware, categoriasCtrl.listarPlantillas);
app.post('/api/plantillas', authMiddleware, requireRole('regente'), categoriasCtrl.crearPlantilla);
app.delete('/api/plantillas/:id', authMiddleware, requireRole('regente'), categoriasCtrl.eliminarPlantilla);
app.post('/api/plantillas/:id/usar', authMiddleware, categoriasCtrl.usarPlantilla);

// Gestión de Usuarios y Roles
app.get('/api/usuarios', authMiddleware, requireRole('regente'), usuariosCtrl.listarUsuarios);
app.post('/api/usuarios', authMiddleware, requireRole('regente'), usuariosCtrl.crearUsuario);
app.put('/api/usuarios/:id', authMiddleware, requireRole('regente'), usuariosCtrl.actualizarUsuario);
app.put('/api/usuarios/:id/password', authMiddleware, usuariosCtrl.cambiarPassword);

// Middleware centralizado de errores
app.use(errorHandler);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[GIE-BACKEND] Servidor API escuchando en http://0.0.0.0:${PORT}`);
});
