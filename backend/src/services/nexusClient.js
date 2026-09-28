const NEXUS_GATEWAY_URL = process.env.NEXUS_GATEWAY_URL || 'http://nexus-backend:3000/api/v1/gateway';
const NEXUS_API_KEY = process.env.NEXUS_API_KEY || 'nx_gie_f8a92b3c4d5e6f7a';

export async function fetchNexusTabla(tabla, campos, orden) {
    const resultados = [];
    const limite = 1000;
    let offset = 0;

    while (true) {
        const payload = {
            tabla,
            datos: { campos, limite, offset, orden }
        };

        const res = await fetch(NEXUS_GATEWAY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': NEXUS_API_KEY
            },
            body: JSON.stringify(payload)
        });

        const bodyText = await res.text();
        let json;
        try {
            json = JSON.parse(bodyText);
        } catch (err) {
            throw new Error(`Respuesta no JSON del Gateway de Nexus (${res.status}): ${bodyText.slice(0, 150)}`);
        }

        if (!res.ok || json.error) {
            throw new Error(json.error || `Gateway Nexus respondió status ${res.status}`);
        }

        const data = Array.isArray(json.data) ? json.data : [];
        resultados.push(...data);

        if (data.length < limite) break;
        offset += limite;
    }

    return resultados;
}

export async function fetchCursosYNexusAlumnos() {
    const [cursos, alumnos] = await Promise.all([
        fetchNexusTabla('cursos', 'id_curso, anio, division, turno, especialidad', { columna: 'id_curso', ascendente: true }),
        fetchNexusTabla('alumnos', 'id, dni, nombre, apellido, email, id_curso', { columna: 'apellido', ascendente: true })
    ]);

    return { cursos, alumnos };
}
