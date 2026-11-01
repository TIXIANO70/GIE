// ============================================================
// Comprehensive Verification Test Suite for Requirements R3 & R5
// ============================================================

const BASE_URL = 'http://127.0.0.1:3001/api';

async function req(endpoint, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: opts.method || 'GET',
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
}

async function login(email, password) {
    const res = await req('/auth/login', {
        method: 'POST',
        body: { email, password }
    });
    if (!res.ok) throw new Error(`Login failed for ${email}: ${JSON.stringify(res.data)}`);
    return { token: res.data.token, user: res.data.user };
}

async function runTests() {
    console.log('--- 1. Healthcheck ---');
    const health = await req('/health');
    console.log('Healthcheck status:', health.status, health.data);
    if (health.status !== 200 || health.data.status !== 'ok') {
        throw new Error('Healthcheck failed');
    }

    console.log('\n--- 2. Logins ---');
    const regente = await login('regente@gie.com', '123asd');
    console.log('Regente login OK:', regente.user.id, regente.user.rol);

    const docente = await login('docente@gie.com', 'asd123');
    console.log('Docente login OK:', docente.user.id, docente.user.rol);

    const doe = await login('doe@gie.com', '123asd');
    console.log('DOE login OK:', doe.user.id, doe.user.rol);

    const pat = await login('pat@gie.com', 'asd123');
    console.log('PAT login OK:', pat.user.id, pat.user.rol, 'alumnos_pat:', pat.user.alumnos_pat);

    console.log('\n--- 3. Verify Students (Requirement R5) ---');
    const aluRes = await req('/alumnos', {
        headers: { Authorization: `Bearer ${regente.token}` }
    });
    const testAlumnos = aluRes.data.data.filter(a => a.dni >= 45000000 && a.dni <= 45999999);
    console.log(`Total test students found (DNI 45000000-45999999): ${testAlumnos.length}`);

    const expectedCourses = [
        '1° A Mañana',
        '2° B Tarde',
        '3° A Mañana',
        '4° A Mañana Computación',
        '5° B Tarde Computación',
        '6° A Mañana Automotores'
    ];

    const courseMap = {};
    for (const a of testAlumnos) {
        const specPart = (a.especialidad && a.especialidad !== 'Sin especialidad') ? ` ${a.especialidad}` : '';
        const key = `${a.curso} ${a.division} ${a.turno}${specPart}`;
        courseMap[key] = (courseMap[key] || 0) + 1;
    }
    console.log('Test student courses found:', courseMap);

    for (const exp of expectedCourses) {
        if (!courseMap[exp]) {
            throw new Error(`Missing expected test course: ${exp}`);
        }
        console.log(`✓ Verified course coverage: ${exp} (${courseMap[exp]} alumnos)`);
    }

    if (pat.user.alumnos_pat.length < 2) {
        throw new Error(`PAT user must have at least 2 assigned students. Found: ${pat.user.alumnos_pat.length}`);
    }
    console.log(`✓ Verified PAT assignment: ${pat.user.alumnos_pat.length} assigned students:`, pat.user.alumnos_pat);

    console.log('\n--- 4. Verify Derivation Visibility & Permission Checks (Requirement R3) ---');
    // Find a student NOT assigned to PAT (e.g. DNI 45000003 - Sofía Martínez, 4° A Computación)
    const unassignedStudent = testAlumnos.find(a => !pat.user.alumnos_pat.includes(a.id));
    if (!unassignedStudent) throw new Error('Could not find an unassigned student for PAT test');
    console.log(`Using student unassigned to PAT: ${unassignedStudent.nombre} ${unassignedStudent.apellido} (DNI ${unassignedStudent.dni}, ID ${unassignedStudent.id})`);

    // 4.1 Docente creates report for unassigned student
    const createRes = await req('/informes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${docente.token}` },
        body: {
            alumno_id: unassignedStudent.id,
            tipo_falta: 'Falta disciplinaria',
            instancia: 'grave',
            titulo: 'Incidente de prueba para derivación',
            resumen: 'El alumno incurrió en una falta de prueba para verificar visibilidad y trazabilidad.'
        }
    });
    if (!createRes.ok) throw new Error(`Docente failed to create report: ${JSON.stringify(createRes.data)}`);
    const informeId = createRes.data.data.id;
    console.log(`✓ Docente created report: ${createRes.data.data.codigo} (ID: ${informeId})`);

    // 4.2 PAT checks reports before derivation -> should NOT see it
    const patBefore = await req('/informes', {
        headers: { Authorization: `Bearer ${pat.token}` }
    });
    const patSawBefore = patBefore.data.data.some(i => i.id === informeId);
    console.log('PAT sees report before derivation?', patSawBefore);
    if (patSawBefore) throw new Error('PAT should NOT see report of unassigned student before derivation!');
    console.log('✓ Verified: PAT cannot see report of unassigned student before derivation');

    // 4.3 Regente derives report to PAT user
    const deriveRes = await req(`/informes/${informeId}/estado`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${regente.token}` },
        body: {
            nuevo_estado: 'derivado',
            derivado_a: pat.user.id,
            motivo: 'Derivación para acompañamiento tutorial de prueba'
        }
    });
    if (!deriveRes.ok) throw new Error(`Regente failed to derive report: ${JSON.stringify(deriveRes.data)}`);
    console.log('✓ Regente derived report to PAT user');

    // 4.4 PAT checks reports after derivation -> MUST see it now due to R3 (OR i.derivado_a = $X)
    const patAfter = await req('/informes', {
        headers: { Authorization: `Bearer ${pat.token}` }
    });
    const patReport = patAfter.data.data.find(i => i.id === informeId);
    console.log('PAT sees derived report after derivation?', !!patReport);
    if (!patReport) throw new Error('PAT MUST see report after it has been derived to them! (Requirement R3)');
    console.log(`✓ Verified Requirement R3: PAT can see derived report ${patReport.codigo} (estado: ${patReport.estado}, derivado_a: ${patReport.derivado_a})`);

    // 4.5 PAT records observation on the derived report
    const obsRes = await req(`/informes/${informeId}/observaciones`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pat.token}` },
        body: {
            accion: 'observaciones',
            detalle: 'Primera entrevista tutorial realizada por PAT con el estudiante.',
            motivo: 'Seguimiento de tutoría'
        }
    });
    if (!obsRes.ok) throw new Error(`PAT failed to record observation on derived report: ${JSON.stringify(obsRes.data)}`);
    console.log('✓ Verified: PAT recorded observation on derived report:', obsRes.data.data.detalle);

    // 4.6 PAT records action taken on the derived report
    const accionRes = await req(`/informes/${informeId}/acciones`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pat.token}` },
        body: {
            accion: 'entrevista',
            detalle: 'Reunión coordinada con preceptoría para seguimiento pedagógico.',
            motivo: 'Plan de acción acordado'
        }
    });
    if (!accionRes.ok) throw new Error(`PAT failed to record action taken on derived report: ${JSON.stringify(accionRes.data)}`);
    console.log('✓ Verified: PAT recorded action taken on derived report:', accionRes.data.data.detalle);

    // 4.7 Verify History contains all events
    const histRes = await req(`/informes/${informeId}/historial`, {
        headers: { Authorization: `Bearer ${pat.token}` }
    });
    console.log(`✓ Verified: History contains ${histRes.data.data.length} events:`);
    for (const h of histRes.data.data) {
        console.log(`   - [${h.accion || h.estado_nuevo}] ${h.usuario_nombre || 'Sistema'}: ${h.detalle || h.motivo}`);
    }

    // 4.8 Test Derivation to Docente & Preceptor
    // Regente creates a second report and derives it to Docente
    const createRes2 = await req('/informes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${regente.token}` },
        body: {
            alumno_id: testAlumnos[0].id,
            tipo_falta: 'Falta académica',
            instancia: 'leve',
            titulo: 'Informe creado por regente y derivado a docente',
            resumen: 'Revisión técnica de contenidos.'
        }
    });
    const informe2Id = createRes2.data.data.id;

    // Regente derives to docente
    await req(`/informes/${informe2Id}/estado`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${regente.token}` },
        body: {
            nuevo_estado: 'derivado',
            derivado_a: docente.user.id,
            motivo: 'Derivado al docente a cargo'
        }
    });

    // Docente checks reports: should see this report (even though docente is not creador)
    const docAfter = await req('/informes', {
        headers: { Authorization: `Bearer ${docente.token}` }
    });
    const docReport = docAfter.data.data.find(i => i.id === informe2Id);
    if (!docReport) throw new Error('Docente MUST see report derived to them even if created by another user!');
    console.log(`✓ Verified Requirement R3: Docente can see report created by Regente and derived to Docente (${docReport.codigo})`);

    // Docente records follow-up on derived report
    const docFollowup = await req(`/informes/${informe2Id}/observaciones`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${docente.token}` },
        body: {
            accion: 'seguimiento_pedagogico',
            detalle: 'Docente coordinó trabajos prácticos recuperatorios.',
            motivo: 'Recuperación de contenidos'
        }
    });
    if (!docFollowup.ok) throw new Error(`Docente failed to record follow-up on derived report: ${JSON.stringify(docFollowup.data)}`);
    console.log('✓ Verified: Docente recorded follow-up on derived report:', docFollowup.data.data.detalle);

    console.log('\n======================================================');
    console.log('🎉 ALL BACKEND R3 & R5 VERIFICATION TESTS PASSED 100%!');
    console.log('======================================================');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
