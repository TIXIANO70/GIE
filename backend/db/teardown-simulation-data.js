import { query, ensureDatabaseReady } from '../src/config/db.js';

export async function teardownSimulationData() {
    console.log('[TEARDOWN-SIMULATION] Ensuring database is ready...');
    await ensureDatabaseReady();

    console.log('[TEARDOWN-SIMULATION] Starting cleanup of simulation data (DNIs 45000000 to 45999999)...');

    // 1. Delete history of reports for test students
    const histRes = await query(`
        DELETE FROM historial_informes
        WHERE informe_id IN (
            SELECT id FROM informes
            WHERE alumno_id IN (
                SELECT id FROM alumnos WHERE dni BETWEEN 45000000 AND 45999999
            )
        )
        RETURNING id
    `);
    console.log(`[TEARDOWN-SIMULATION] Deleted ${histRes.rowCount} historial_informes records.`);

    // 2. Delete observations for test students
    const obsRes = await query(`
        DELETE FROM observaciones_alumno
        WHERE alumno_id IN (
            SELECT id FROM alumnos WHERE dni BETWEEN 45000000 AND 45999999
        )
        RETURNING id
    `);
    console.log(`[TEARDOWN-SIMULATION] Deleted ${obsRes.rowCount} observaciones_alumno records.`);

    // 3. Delete reports for test students
    const infRes = await query(`
        DELETE FROM informes
        WHERE alumno_id IN (
            SELECT id FROM alumnos WHERE dni BETWEEN 45000000 AND 45999999
        )
        RETURNING id
    `);
    console.log(`[TEARDOWN-SIMULATION] Deleted ${infRes.rowCount} informes records.`);

    // 4. Delete test students
    const aluRes = await query(`
        DELETE FROM alumnos
        WHERE dni BETWEEN 45000000 AND 45999999
        RETURNING id, dni
    `);
    console.log(`[TEARDOWN-SIMULATION] Deleted ${aluRes.rowCount} alumnos records.`);

    // 5. Restore alumnos_pat = '[]' on pat@gie.com
    await query(`
        UPDATE usuarios
        SET alumnos_pat = '[]'::jsonb, updated_at = NOW()
        WHERE email = 'pat@gie.com'
    `);
    console.log(`[TEARDOWN-SIMULATION] Restored alumnos_pat = '[]' for pat@gie.com.`);

    // Comprehensive verification checks
    const checkRes = await query(`SELECT COUNT(*) AS total FROM alumnos WHERE dni BETWEEN 45000000 AND 45999999`);
    const checkReports = await query(`SELECT COUNT(*) AS total FROM informes WHERE alumno_id IN (SELECT id FROM alumnos WHERE dni BETWEEN 45000000 AND 45999999)`);
    const checkOrphanReports = await query(`SELECT COUNT(*) AS total FROM informes WHERE alumno_id NOT IN (SELECT id FROM alumnos)`);
    const checkHistory = await query(`SELECT COUNT(*) AS total FROM historial_informes WHERE informe_id NOT IN (SELECT id FROM informes)`);
    const checkObs = await query(`SELECT COUNT(*) AS total FROM observaciones_alumno WHERE alumno_id NOT IN (SELECT id FROM alumnos)`);
    const checkPat = await query(`SELECT email, alumnos_pat FROM usuarios WHERE email = 'pat@gie.com'`);

    console.log(`[TEARDOWN-SIMULATION] Verification check: ${checkRes.rows[0].total} test students remain.`);
    console.log(`[TEARDOWN-SIMULATION] Verification check: ${checkReports.rows[0].total} test reports remain.`);
    console.log(`[TEARDOWN-SIMULATION] Verification check: ${checkOrphanReports.rows[0].total} orphan reports remain.`);
    console.log(`[TEARDOWN-SIMULATION] Verification check: ${checkHistory.rows[0].total} orphan history records remain.`);
    console.log(`[TEARDOWN-SIMULATION] Verification check: ${checkObs.rows[0].total} orphan observations remain.`);
    console.log(`[TEARDOWN-SIMULATION] Verification check: pat@gie.com alumnos_pat =`, JSON.stringify(checkPat.rows[0]?.alumnos_pat));

    return {
        deletedHistory: histRes.rowCount,
        deletedObservations: obsRes.rowCount,
        deletedReports: infRes.rowCount,
        deletedStudents: aluRes.rowCount,
        remainingStudents: parseInt(checkRes.rows[0].total, 10),
        remainingReports: parseInt(checkReports.rows[0].total, 10),
        remainingOrphanReports: parseInt(checkOrphanReports.rows[0].total, 10),
        remainingOrphanHistory: parseInt(checkHistory.rows[0].total, 10),
        remainingOrphanObs: parseInt(checkObs.rows[0].total, 10),
        patAlumnos: checkPat.rows[0]?.alumnos_pat
    };
}

if (process.argv[1]?.endsWith('teardown-simulation-data.js')) {
    teardownSimulationData()
        .then((res) => {
            console.log('[TEARDOWN-SIMULATION] Teardown completed successfully:', res);
            process.exit(0);
        })
        .catch((err) => {
            console.error('[TEARDOWN-SIMULATION] Error during teardown:', err);
            process.exit(1);
        });
}
