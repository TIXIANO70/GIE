import { pool, query, ensureDatabaseReady } from '../src/config/db.js';

export const TEST_STUDENTS = [
    { dni: 45000001, nombre: 'Lucía', apellido: 'González', curso: '3°', division: 'A', turno: 'Mañana', especialidad: 'Sin especialidad' },
    { dni: 45000002, nombre: 'Mateo', apellido: 'Fernández', curso: '3°', division: 'A', turno: 'Mañana', especialidad: 'Sin especialidad' },
    { dni: 45000003, nombre: 'Sofía', apellido: 'Martínez', curso: '4°', division: 'A', turno: 'Mañana', especialidad: 'Computación' },
    { dni: 45000004, nombre: 'Benjamín', apellido: 'López', curso: '4°', division: 'A', turno: 'Mañana', especialidad: 'Computación' },
    { dni: 45000005, nombre: 'Valentina', apellido: 'Pérez', curso: '5°', division: 'B', turno: 'Tarde', especialidad: 'Computación' },
    { dni: 45000006, nombre: 'Thiago', apellido: 'Ramírez', curso: '5°', division: 'B', turno: 'Tarde', especialidad: 'Computación' },
    { dni: 45000007, nombre: 'Emma', apellido: 'Torres', curso: '5°', division: 'B', turno: 'Tarde', especialidad: 'Computación' },
    { dni: 45000008, nombre: 'Bautista', apellido: 'Sosa', curso: '6°', division: 'A', turno: 'Mañana', especialidad: 'Automotores' },
    { dni: 45000009, nombre: 'Isabella', apellido: 'Acosta', curso: '6°', division: 'A', turno: 'Mañana', especialidad: 'Automotores' },
    { dni: 45000010, nombre: 'Gaspar', apellido: 'Benítez', curso: '2°', division: 'B', turno: 'Tarde', especialidad: 'Sin especialidad' },
    { dni: 45000011, nombre: 'Catalina', apellido: 'Medina', curso: '2°', division: 'B', turno: 'Tarde', especialidad: 'Sin especialidad' },
    { dni: 45000012, nombre: 'Lorenzo', apellido: 'Vega', curso: '1°', division: 'A', turno: 'Mañana', especialidad: 'Sin especialidad' }
];

export async function seedSimulationStudents() {
    console.log('[SEED-SIMULATION] Ensuring database is ready...');
    await ensureDatabaseReady();

    console.log(`[SEED-SIMULATION] Inserting ${TEST_STUDENTS.length} test students from Nexus...`);
    const insertedIds = [];

    for (const st of TEST_STUDENTS) {
        const res = await query(
            `INSERT INTO alumnos (dni, nombre, apellido, curso, division, turno, especialidad, activo, synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW())
             ON CONFLICT (dni) DO UPDATE SET
                nombre = EXCLUDED.nombre,
                apellido = EXCLUDED.apellido,
                curso = EXCLUDED.curso,
                division = EXCLUDED.division,
                turno = EXCLUDED.turno,
                especialidad = EXCLUDED.especialidad,
                activo = TRUE,
                synced_at = NOW()
             RETURNING id, dni, nombre, apellido, curso, division, turno, especialidad`,
            [st.dni, st.nombre, st.apellido, st.curso, st.division, st.turno, st.especialidad]
        );
        insertedIds.push(res.rows[0]);
    }

    console.log(`[SEED-SIMULATION] ${insertedIds.length} test students successfully inserted/updated.`);

    // Assign at least 2 students to pat@gie.com (Lucía González 45000001 and Mateo Fernández 45000002)
    const patStudents = insertedIds.filter(s => s.dni === 45000001 || s.dni === 45000002).map(s => s.id);

    console.log('[SEED-SIMULATION] Assigning students to pat@gie.com:', patStudents);
    await query(
        `UPDATE usuarios
         SET alumnos_pat = $1::jsonb, updated_at = NOW()
         WHERE email = 'pat@gie.com'`,
        [JSON.stringify(patStudents)]
    );

    const patUser = await query(`SELECT email, nombre, apellido, rol, alumnos_pat FROM usuarios WHERE email = 'pat@gie.com'`);
    console.log('[SEED-SIMULATION] PAT User verification:', patUser.rows[0]);

    return {
        count: insertedIds.length,
        students: insertedIds,
        patAssignedIds: patStudents
    };
}

// Allow direct CLI execution
if (process.argv[1]?.endsWith('seed-simulation-students.js')) {
    seedSimulationStudents()
        .then((res) => {
            console.log('[SEED-SIMULATION] Seeding completed successfully:', {
                count: res.count,
                patAssignedCount: res.patAssignedIds.length
            });
            process.exit(0);
        })
        .catch((err) => {
            console.error('[SEED-SIMULATION] Error during seeding:', err);
            process.exit(1);
        });
}
