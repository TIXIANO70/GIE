import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const poolConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || 'gie-postgres',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'gie',
        user: process.env.DB_USER || 'gie_user',
        password: process.env.DB_PASSWORD || 'gie_local_secure_password',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    };

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
    console.error('[DB] Error inesperado en el cliente inactivo de PostgreSQL:', err);
});

export async function query(text, params) {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
        console.log(`[DB] Query ejecutada en ${duration}ms: ${text.slice(0, 80)}`);
    }
    return res;
}
