import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Pool } = pg;

const host = process.env.DB_HOST || '127.0.0.1';
const port = parseInt(process.env.DB_PORT || '5432', 10);
const database = process.env.DB_NAME || 'gie';
const user = process.env.DB_USER || 'gie_user';
const password = process.env.DB_PASSWORD || 'gie_local_secure_password';

const poolConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host,
        port,
        database,
        user,
        password,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    };

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
    console.error('[DB] Error inesperado en el cliente inactivo de PostgreSQL:', err);
});

let _embeddedPg = null;
let _readyPromise = null;

export async function ensureDatabaseReady() {
    if (_readyPromise) return _readyPromise;
    _readyPromise = (async () => {
        // Intentar conectar con PostgreSQL existente
        try {
            const client = new pg.Client({ host, port, database, user, password, connectionTimeoutMillis: 2000 });
            await client.connect();
            await client.query('SELECT 1');
            await client.end();
            console.log(`[DB] Conexión establecida con PostgreSQL en ${host}:${port}`);
        } catch (err) {
            console.log(`[DB] PostgreSQL no activo en ${host}:${port} (${err.message}). Iniciando embedded postgres...`);
            const dbDir = path.resolve(__dirname, '../../data/pg_data');
            if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

            const { default: EmbeddedPostgres } = await import('embedded-postgres');
            _embeddedPg = new EmbeddedPostgres({
                databaseDir: dbDir,
                port,
                user,
                password,
                persistent: true,
                authMethod: 'password',
                autoRehydrateSymlinks: true,
                initdbFlags: ['--no-sync'],
                postgresFlags: ['-c', 'fsync=off', '-c', 'synchronous_commit=off'],
                onError: () => {}
            });

            try {
                await _embeddedPg.initialise();
            } catch (initErr) {
                // Si ya fue inicializado, continuar
            }
            await _embeddedPg.start();
            console.log(`[DB] Embedded PostgreSQL iniciado exitosamente en puerto ${port}`);

            try {
                await _embeddedPg.createDatabase(database);
            } catch (dbErr) {
                // Si la BD ya existe, continuar
            }
        }

        // Verificar o cargar esquemas iniciales
        const checkClient = new pg.Client({ host, port, database, user, password });
        await checkClient.connect();

        const tableCheck = await checkClient.query("SELECT to_regclass('public.usuarios') AS exists");
        if (!tableCheck.rows[0].exists) {
            console.log('[DB] Ejecutando esquemas iniciales (init.sql y seed-initial.sql)...');
            const initSqlPath = path.resolve(__dirname, '../../db/init.sql');
            const seedSqlPath = path.resolve(__dirname, '../../db/seed-initial.sql');
            if (fs.existsSync(initSqlPath)) {
                await checkClient.query(fs.readFileSync(initSqlPath, 'utf8'));
            }
            if (fs.existsSync(seedSqlPath)) {
                await checkClient.query(fs.readFileSync(seedSqlPath, 'utf8'));
            }
            console.log('[DB] Esquemas iniciales cargados exitosamente.');
        }

        await checkClient.end();
    })();
    return _readyPromise;
}

export async function query(text, params) {
    await ensureDatabaseReady();
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        if (process.env.NODE_ENV === 'development') {
            console.log(`[DB] Query ejecutada en ${duration}ms: ${text.slice(0, 80)}`);
        }
        return res;
    } catch (err) {
        if (err.code === 'ECONNREFUSED' || err.message?.includes('Connection terminated') || err.message?.includes('closed')) {
            console.warn('[DB] Conexión perdida con PostgreSQL. Reconectando...');
            _readyPromise = null;
            await ensureDatabaseReady();
            return pool.query(text, params);
        }
        throw err;
    }
}
