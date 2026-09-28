import { getAlumno, informes } from './db.js';
import { charts } from './app.js';
import Chart from 'chart.js/auto';

export function cargarEstadisticas() {
    const porCurso = {};
    informes.forEach(i => {
        const alumno = getAlumno(i.alumno_id);
        if (alumno) porCurso[alumno.curso] = (porCurso[alumno.curso] || 0) + 1;
    });
    const ctxCursos = document.getElementById('chartCursos').getContext('2d');
    if (charts.cursos) charts.cursos.destroy();
    charts.cursos = new Chart(ctxCursos, {
        type: 'bar',
        data: { labels: Object.keys(porCurso), datasets: [{ label: 'Informes', data: Object.values(porCurso), backgroundColor: '#3b82f6', borderRadius: 6 }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });

    const porTipo = {};
    informes.forEach(i => { porTipo[i.tipo_falta] = (porTipo[i.tipo_falta] || 0) + 1; });
    const ctxTipos = document.getElementById('chartTipos').getContext('2d');
    if (charts.tipos) charts.tipos.destroy();
    charts.tipos = new Chart(ctxTipos, {
        type: 'pie',
        data: { labels: Object.keys(porTipo), datasets: [{ data: Object.values(porTipo), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'] }] },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });

    const mensual = {};
    informes.forEach(i => {
        const fecha = new Date(i.fecha_creacion);
        const key = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
        mensual[key] = (mensual[key] || 0) + 1;
    });
    const sortedKeys = Object.keys(mensual).sort();
    const ctxMensual = document.getElementById('chartMensual').getContext('2d');
    if (charts.mensual) charts.mensual.destroy();
    charts.mensual = new Chart(ctxMensual, {
        type: 'line',
        data: {
            labels: sortedKeys.map(k => { const [a, m] = k.split('-'); return `${m}/${a}`; }),
            datasets: [{ label: 'Informes por mes', data: sortedKeys.map(k => mensual[k]), borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.4 }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });

    const porAlumno = {};
    informes.forEach(i => {
        const alumno = getAlumno(i.alumno_id);
        if (!alumno) return;
        const key = `${alumno.apellido}, ${alumno.nombre}`;
        if (!porAlumno[key]) porAlumno[key] = { total: 0, leve: 0, grave: 0, muy_grave: 0, curso: `${alumno.curso} ${alumno.division}`, id: alumno.id };
        porAlumno[key].total++;
        porAlumno[key][i.instancia]++;
    });
    const topAlumnos = Object.entries(porAlumno).sort((a, b) => b[1].total - a[1].total).slice(0, 10);
    document.getElementById('bodyTopAlumnos').innerHTML = topAlumnos.map(([nombre, stats]) => `
        <tr class="hover:bg-slate-50 cursor-pointer" onclick="verAlumno('${stats.id}')">
            <td class="px-4 py-3 font-medium">${nombre}</td>
            <td class="px-4 py-3 text-slate-500">${stats.curso}</td>
            <td class="px-4 py-3 text-center font-bold">${stats.total}</td>
            <td class="px-4 py-3 text-center text-amber-600">${stats.leve}</td>
            <td class="px-4 py-3 text-center text-orange-600">${stats.grave}</td>
            <td class="px-4 py-3 text-center text-red-600">${stats.muy_grave}</td>
        </tr>
    `).join('');
}
