import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    esInstanciaCritica,
    notificarEventoAvisos,
    despacharNotificacionYAuditar,
} from '../src/services/avisosClient.js';

describe('avisosClient (puente GIE -> Avisos)', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('identifies critical instances properly', () => {
        assert.equal(esInstanciaCritica('grave'), true);
        assert.equal(esInstanciaCritica('muy_grave'), true);
        assert.equal(esInstanciaCritica('consejo_aula'), true);
        assert.equal(esInstanciaCritica('consejo'), true);
        assert.equal(esInstanciaCritica('leve'), false);
        assert.equal(esInstanciaCritica(null), false);
    });

    it('sends structured payload with x-internal-key and idempotency_key', async () => {
        let capturedUrl = null;
        let capturedOptions = null;

        global.fetch = async (url, options) => {
            capturedUrl = url;
            capturedOptions = options;
            return new Response(JSON.stringify({ ok: true, estado: 'enviado', total: 1, exitosos: 1 }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        };

        const res = await notificarEventoAvisos({
            evento: 'citacion_reunion',
            informe: { id: 'uuid-1', codigo: '2026-0010', instancia: 'grave', titulo: 'Citación', resumen: 'Detalle' },
            alumno: { nexus_id: 'nx-1', dni: 45000001, nombre: 'Lucía', apellido: 'González', curso: '3°', division: 'A' },
            autorNombre: 'Regente, GIE',
            fechaReunion: '2026-11-25',
        });

        assert.equal(res.ok, true);
        assert.equal(res.estado, 'enviado');
        assert.ok(capturedUrl.endsWith('/api/internal/notificar'));
        assert.equal(capturedOptions.headers['x-internal-key'], 'red35_internal_bridge_secret_key');

        const parsedBody = JSON.parse(capturedOptions.body);
        assert.equal(parsedBody.idempotency_key, 'gie:2026-0010:citacion_reunion:2026-11-25');
        assert.equal(parsedBody.alumno.dni, 45000001);
        assert.equal(parsedBody.alumno.curso, '3° A');
    });

    it('never throws when Avisos is offline', async () => {
        global.fetch = async () => {
            throw new Error('fetch failed: ECONNREFUSED');
        };

        const res = await notificarEventoAvisos({
            evento: 'citacion_reunion',
            informe: { id: 'uuid-2', codigo: '2026-0011', instancia: 'muy_grave', titulo: 'Test' },
            alumno: { dni: 45000002, nombre: 'Mateo', apellido: 'Fernández' },
            fechaReunion: '2026-11-28',
        });

        assert.equal(res.ok, false);
        assert.equal(res.offline, true);
    });

    it('audits dispatch outcome into historial_informes', async () => {
        global.fetch = async () => new Response(
            JSON.stringify({ ok: true, estado: 'enviado', total: 2, exitosos: 2 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

        const sqlCalls = [];
        const mockQueryFn = async (sql, params) => {
            sqlCalls.push({ sql, params });
            if (sql.includes('FROM alumnos')) {
                return {
                    rows: [{ nexus_id: 'nx-1', dni: 45000001, nombre: 'Lucía', apellido: 'González', curso: '3°', division: 'A' }],
                };
            }
            return { rows: [] };
        };

        const res = await despacharNotificacionYAuditar({
            queryFn: mockQueryFn,
            evento: 'citacion_reunion',
            informe: { id: 'inf-1', codigo: '2026-0012', instancia: 'grave', titulo: 'Citación', resumen: 'Resumen' },
            alumnoId: 'al-1',
            user: { id: 'usr-1', nombre: 'Admin', apellido: 'GIE' },
            fechaReunion: '2026-11-29',
        });

        assert.equal(res.ok, true);
        const histInsert = sqlCalls.find((c) => c.sql.includes('INSERT INTO historial_informes'));
        assert.ok(histInsert, 'Debe insertar auditoría en historial_informes');
        assert.equal(histInsert.params[3], 'notificacion_externa');
        assert.match(histInsert.params[4], /2\/2 correos/);
    });
});
