import { getAlumno, informes } from './db.js';
import { formatearFechaCorta, cerrarModal, showSection, charts } from './app.js';
import Chart from 'chart.js/auto';

export function verAlumno(alumnoId) {
    const alumno = getAlumno(alumnoId);
    if (!alumno) return;
    const lista = informes.filter(i => i.alumno_id === alumnoId).sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));
    const stats = { total: lista.length, leve: 0, grave: 0, muy_grave: 0 };
    lista.forEach(i => stats[i.instancia]++);

    document.getElementById('tarjetaAlumno').innerHTML = `
        <div class="flex items-center gap-4">
            <div class="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center text-white text-2xl font-bold">${alumno.nombre[0]}${alumno.apellido[0]}</div>
            <div>
                <h2 class="text-xl font-bold text-slate-800">${alumno.apellido}, ${alumno.nombre}</h2>
                <p class="text-slate-500">${alumno.curso} ${alumno.division}</p>
                <p class="text-sm text-slate-400 mt-1">${stats.total} informe${stats.total !== 1 ? 's' : ''} registrado${stats.total !== 1 ? 's' : ''}</p>
            </div>
        </div>
        <div class="grid grid-cols-3 gap-4 mt-6">
            <div class="text-center p-3 bg-amber-50 rounded-lg"><p class="text-2xl font-bold text-amber-600">${stats.leve}</p><p class="text-xs text-amber-700">Leves</p></div>
            <div class="text-center p-3 bg-orange-50 rounded-lg"><p class="text-2xl font-bold text-orange-600">${stats.grave}</p><p class="text-xs text-orange-700">Graves</p></div>
            <div class="text-center p-3 bg-red-50 rounded-lg"><p class="text-2xl font-bold text-red-600">${stats.muy_grave}</p><p class="text-xs text-red-700">Muy Graves</p></div>
        </div>
    `;

    const ctx = document.getElementById('chartAlumno').getContext('2d');
    if (charts.alumno) charts.alumno.destroy();
    charts.alumno = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['Leve', 'Grave', 'Muy Grave'], datasets: [{ data: [stats.leve, stats.grave, stats.muy_grave], backgroundColor: ['#fbbf24', '#f97316', '#ef4444'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });

    document.getElementById('historialAlumno').innerHTML = lista.map(i => `
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 instancia-${i.instancia}">
            <div class="flex items-center gap-2 mb-1 flex-wrap">
                <span class="status-${i.estado} px-2 py-0.5 rounded-full text-xs font-medium capitalize">${i.estado.replace('_', ' ')}</span>
                <span class="text-xs text-slate-500">${formatearFechaCorta(i.fecha_creacion)}</span>
            </div>
            <h4 class="font-semibold text-slate-800">${i.titulo}</h4>
            <p class="text-sm text-slate-600 line-clamp-2">${i.resumen}</p>
            <button onclick="verDetalle('${i.id}')" class="text-sm text-blue-600 hover:text-blue-700 mt-2">Ver detalle <i class="fas fa-arrow-right text-xs"></i></button>
        </div>
    `).join('');

    cerrarModal();
    showSection('vistaAlumno');
}
