import { getAlumno, informes } from './db.js';
import { formatearFechaCorta, charts } from './app.js';
import Chart from 'chart.js/auto';

export function actualizarDashboard() {
    const estados = { pendiente: 0, en_revision: 0, aprobado: 0, rechazado: 0, archivado: 0 };
    const instancias = { leve: 0, grave: 0, muy_grave: 0 };
    informes.forEach(i => {
        if (estados[i.estado] !== undefined) estados[i.estado]++;
        if (instancias[i.instancia] !== undefined) instancias[i.instancia]++;
    });
    document.getElementById('dashPendientes').textContent = estados.pendiente;
    document.getElementById('dashRevision').textContent = estados.en_revision;
    document.getElementById('dashAprobados').textContent = estados.aprobado;
    document.getElementById('dashTotal').textContent = informes.length;

    const reciente = informes.slice(0, 10);
    document.getElementById('actividadReciente').innerHTML = reciente.map(i => {
        const alumno = getAlumno(i.alumno_id);
        return `
        <div class="flex items-start gap-3 p-3 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer" onclick="verDetalle('${i.id}')">
            <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${i.estado === 'aprobado' ? 'bg-green-500' : i.estado === 'rechazado' ? 'bg-red-500' : i.estado === 'pendiente' ? 'bg-blue-500' : 'bg-amber-500'}">${alumno ? alumno.nombre[0] + alumno.apellido[0] : '?'}</div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-slate-800 truncate">${i.titulo}</p>
                <p class="text-xs text-slate-500">${alumno ? `${alumno.apellido}, ${alumno.nombre}` : 'Desconocido'} • ${formatearFechaCorta(i.fecha_creacion)}</p>
            </div>
            <span class="status-${i.estado} px-2 py-0.5 rounded text-xs capitalize">${i.estado.replace('_', ' ')}</span>
        </div>`;
    }).join('');

    const ctx = document.getElementById('dashChart').getContext('2d');
    if (charts.dash) charts.dash.destroy();
    charts.dash = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['Leve', 'Grave', 'Muy Grave'], datasets: [{ data: [instancias.leve, instancias.grave, instancias.muy_grave], backgroundColor: ['#fbbf24', '#f97316', '#ef4444'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
}
