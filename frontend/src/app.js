import { alumnos, informes, perfil, getAlumno, getInforme, getNombreUsuario, cargarInformes, saveDB, getDB } from './db.js';
import { USE_SUPABASE, supabaseClient } from './config.js';

export let charts = {};
let rechazoId = null;

export function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    const el = document.getElementById(sectionId);
    if (el) el.classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(b => {
        if (b.dataset.section === sectionId) b.classList.add('bg-slate-800', 'text-blue-400');
        else b.classList.remove('bg-slate-800', 'text-blue-400');
    });
    if (sectionId === 'estadisticas') import('./estadisticas.js').then(m => m.cargarEstadisticas());
    if (sectionId === 'usuarios') import('./usuarios.js').then(m => m.cargarUsuarios());
    if (sectionId === 'dashboard') import('./dashboard.js').then(m => m.actualizarDashboard());
    if (sectionId === 'informes') filtrarInformes();
    if (window.innerWidth < 1024) {
        document.getElementById('sidebar').classList.add('sidebar-hidden');
        document.getElementById('overlay').classList.add('hidden');
    }
    window.scrollTo(0, 0);
}

export function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('sidebar-hidden');
    document.getElementById('overlay').classList.toggle('hidden');
}

export function formatearFecha(fecha) {
    if (!fecha) return 'N/A';
    return new Date(fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatearFechaCorta(fecha) {
    if (!fecha) return 'N/A';
    return new Date(fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function generarId() {
    return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export function mostrarToast(mensaje, tipo = 'success') {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toastIcon');
    const msg = document.getElementById('toastMsg');
    msg.textContent = mensaje;
    icon.className = tipo === 'error' ? 'fas fa-exclamation-circle text-red-400' : 'fas fa-check-circle text-green-400';
    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 3000);
}

export function initFiltros() {
    // Ya se poblaron en cargarAlumnos
}

export function buscarAlumno(query) {
    const resultados = document.getElementById('resultadosAlumno');
    if (!query || query.length < 2) { resultados.classList.add('hidden'); return; }
    const filtrados = alumnos.filter(a =>
        `${a.nombre} ${a.apellido}`.toLowerCase().includes(query.toLowerCase()) ||
        `${a.apellido} ${a.nombre}`.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 10);
    if (filtrados.length === 0) {
        resultados.innerHTML = '<div class="p-3 text-sm text-slate-500">No se encontraron alumnos</div>';
    } else {
        resultados.innerHTML = filtrados.map(a => `
            <div onclick="seleccionarAlumno('${a.id}', '${a.nombre}', '${a.apellido}', '${a.curso}', '${a.division}')"
                class="p-3 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0">
                <p class="font-medium text-sm">${a.apellido}, ${a.nombre}</p>
                <p class="text-xs text-slate-500">${a.curso} ${a.division}</p>
            </div>`).join('');
    }
    resultados.classList.remove('hidden');
}

export function seleccionarAlumno(id, nombre, apellido, curso, division) {
    document.getElementById('alumnoId').value = id;
    document.getElementById('alumnoNombre').textContent = `${apellido}, ${nombre}`;
    document.getElementById('alumnoCurso').textContent = `${curso} ${division}`;
    document.getElementById('alumnoSeleccionado').classList.remove('hidden');
    document.getElementById('resultadosAlumno').classList.add('hidden');
    document.getElementById('searchAlumno').value = '';
}

export function limpiarAlumno() {
    document.getElementById('alumnoId').value = '';
    document.getElementById('alumnoSeleccionado').classList.add('hidden');
}

export function filtrarInformes() {
    const busqueda = document.getElementById('filtroBusqueda').value.toLowerCase();
    const curso = document.getElementById('filtroCurso').value;
    const estado = document.getElementById('filtroEstado').value;
    const instancia = document.getElementById('filtroInstancia').value;
    const filtrados = informes.filter(i => {
        const alumno = getAlumno(i.alumno_id);
        const matchBusqueda = !busqueda ||
            `${alumno?.apellido || ''} ${alumno?.nombre || ''}`.toLowerCase().includes(busqueda) ||
            i.titulo.toLowerCase().includes(busqueda) ||
            i.resumen.toLowerCase().includes(busqueda);
        const matchCurso = !curso || (alumno && alumno.curso === curso);
        const matchEstado = !estado || i.estado === estado;
        const matchInstancia = !instancia || i.instancia === instancia;
        return matchBusqueda && matchCurso && matchEstado && matchInstancia;
    });
    renderizarInformes(filtrados);
}

export function renderizarInformes(lista) {
    const contenedor = document.getElementById('listaInformes');
    const sinResultados = document.getElementById('sinResultados');
    if (lista.length === 0) { contenedor.innerHTML = ''; sinResultados.classList.remove('hidden'); return; }
    sinResultados.classList.add('hidden');
    contenedor.innerHTML = lista.map(i => {
        const alumno = getAlumno(i.alumno_id);
        return `
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 cursor-pointer hover:shadow-md transition-all instancia-${i.instancia}">
            <div class="flex flex-col sm:flex-row justify-between items-start gap-3" onclick="verDetalle('${i.id}')">
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                        <span class="status-${i.estado} px-2 py-0.5 rounded-full text-xs font-medium capitalize">${i.estado.replace('_', ' ')}</span>
                        <span class="text-xs text-slate-500">${formatearFechaCorta(i.fecha_creacion)}</span>
                    </div>
                    <h3 class="font-semibold text-slate-800 mb-1">${i.titulo}</h3>
                    <p class="text-sm text-slate-600 mb-2"><i class="fas fa-user mr-1"></i>${alumno ? `${alumno.apellido}, ${alumno.nombre}` : 'Desconocido'} • ${alumno ? `${alumno.curso} ${alumno.division}` : ''}</p>
                    <p class="text-sm text-slate-500 line-clamp-2">${i.resumen}</p>
                </div>
                <div class="flex items-center gap-2">
                    ${i.instancia === 'muy_grave' ? '<i class="fas fa-exclamation-triangle text-red-500" title="Muy Grave"></i>' : ''}
                    <i class="fas fa-chevron-right text-slate-400"></i>
                </div>
            </div>
        </div>`;
    }).join('');
}

export function verDetalle(id) {
    const informe = getInforme(id);
    if (!informe) return;
    const alumno = getAlumno(informe.alumno_id);
    const modal = document.getElementById('modalDetalle');
    const contenido = document.getElementById('contenidoModal');
    const acciones = document.getElementById('accionesModal');

    contenido.innerHTML = `
        <div class="flex items-center gap-3 mb-4 flex-wrap">
            <span class="status-${informe.estado} px-3 py-1 rounded-full text-sm font-medium capitalize">${informe.estado.replace('_', ' ')}</span>
            <span class="text-sm text-slate-500">${formatearFecha(informe.fecha_creacion)}</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div class="p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors" onclick="verAlumno('${alumno?.id}')">
                <p class="text-xs text-slate-500 mb-1">Alumno</p>
                <p class="font-medium">${alumno ? `${alumno.apellido}, ${alumno.nombre}` : 'Desconocido'}</p>
                <p class="text-sm text-slate-600">${alumno ? `${alumno.curso} ${alumno.division}` : ''}</p>
                <p class="text-xs text-blue-600 mt-1"><i class="fas fa-eye mr-1"></i>Ver resumen</p>
            </div>
            <div class="p-3 bg-slate-50 rounded-lg">
                <p class="text-xs text-slate-500 mb-1">Creado por</p>
                <p class="font-medium">${getNombreUsuario(informe.creado_por)}</p>
            </div>
        </div>
        <div class="space-y-4">
            <div><p class="text-sm font-medium text-slate-700 mb-1">Título</p><p class="text-slate-600">${informe.titulo}</p></div>
            <div class="grid grid-cols-2 gap-4">
                <div><p class="text-sm font-medium text-slate-700 mb-1">Tipo de Falta</p><p class="text-slate-600">${informe.tipo_falta}</p></div>
                <div><p class="text-sm font-medium text-slate-700 mb-1">Instancia</p>
                    <p class="text-slate-600 capitalize font-medium ${informe.instancia === 'muy_grave' ? 'text-red-600' : informe.instancia === 'grave' ? 'text-orange-600' : 'text-amber-600'}">${informe.instancia}</p>
                </div>
            </div>
            <div><p class="text-sm font-medium text-slate-700 mb-1">Resumen</p><p class="text-slate-600 whitespace-pre-wrap">${informe.resumen}</p></div>
            ${informe.descargo ? `<div class="p-3 bg-amber-50 border border-amber-200 rounded-lg"><p class="text-sm font-medium text-amber-800 mb-1">Descargo del alumno</p><p class="text-amber-700 whitespace-pre-wrap">${informe.descargo}</p></div>` : ''}
            ${informe.motivo_rechazo ? `<div class="p-3 bg-red-50 border border-red-200 rounded-lg"><p class="text-sm font-medium text-red-800 mb-1">Motivo del rechazo</p><p class="text-red-700">${informe.motivo_rechazo}</p></div>` : ''}
            ${informe.fecha_revision ? `<div class="text-sm text-slate-500"><i class="fas fa-check-double mr-1"></i>Revisado por ${getNombreUsuario(informe.revisado_por)} el ${formatearFecha(informe.fecha_revision)}</div>` : ''}
        </div>
    `;

    acciones.innerHTML = '';
    if (informe.creado_por === perfil.id && (informe.estado === 'pendiente' || informe.estado === 'pendiente')) {
        acciones.innerHTML += `<button onclick="editarInforme('${informe.id}')" class="flex-1 min-w-[120px] bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors"><i class="fas fa-edit mr-2"></i>Editar</button>`;
    }
    if (perfil.rol === 'regente') {
        if (informe.estado === 'pendiente' || informe.estado === 'pendiente') {
            acciones.innerHTML += `
                <button onclick="cambiarEstado('${informe.id}', 'aprobado')" class="flex-1 min-w-[120px] bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg transition-colors"><i class="fas fa-check mr-2"></i>Aprobar</button>
                <button onclick="cambiarEstado('${informe.id}', 'pendiente')" class="flex-1 min-w-[120px] bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors"><i class="fas fa-search mr-2"></i>En Revisión</button>
                <button onclick="mostrarRechazo('${informe.id}')" class="flex-1 min-w-[120px] bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg transition-colors"><i class="fas fa-times mr-2"></i>Rechazar</button>`;
        }
        if (informe.estado === 'rechazado') {
            acciones.innerHTML += `<button onclick="cambiarEstado('${informe.id}', 'pendiente')" class="flex-1 min-w-[120px] bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors"><i class="fas fa-redo mr-2"></i>Reactivar</button>`;
        }
    }
    acciones.innerHTML += `<button onclick="exportarPDF('${informe.id}')" class="min-w-[120px] bg-slate-600 hover:bg-slate-700 text-white py-2 rounded-lg transition-colors"><i class="fas fa-file-pdf mr-2"></i>PDF</button>`;
    modal.classList.remove('hidden');
}

export function cerrarModal() { document.getElementById('modalDetalle').classList.add('hidden'); }

export async function cambiarEstado(id, nuevoEstado) {
    const updates = {
        estado: nuevoEstado,
        revisado_por: perfil.id,
        fecha_revision: new Date().toISOString()
    };
    if (nuevoEstado !== 'rechazado') updates.motivo_rechazo = null;

    if (USE_SUPABASE) {
        const { error } = await supabaseClient.from('informes').update(updates).eq('id', id);
        if (error) { 
        
        await cargarInformes();
    } else {
        const db = getDB();
        const idx = db.informes.findIndex(i => i.id === id);
        db.informes[idx] = { ...db.informes[idx], ...updates };
        saveDB(db);
        await cargarInformes();
    }
    mostrarToast(`Informe ${nuevoEstado.replace('_', ' ')} correctamente`);
    cerrarModal();
    filtrarInformes();
    import('./dashboard.js').then(m => m.actualizarDashboard());
}

export function mostrarRechazo(id) {
    rechazoId = id;
    document.getElementById('modalRechazo').classList.remove('hidden');
    document.getElementById('motivoRechazo').value = '';
}

export function cerrarModalRechazo() {
    document.getElementById('modalRechazo').classList.add('hidden');
    rechazoId = null;
}

export async function confirmarRechazo() {
    const motivo = document.getElementById('motivoRechazo').value.trim();
    if (!motivo) return mostrarToast('Debe indicar un motivo', 'error');
    const updates = {
        estado: 'rechazado',
        motivo_rechazo: motivo,
        revisado_por: perfil.id,
        fecha_revision: new Date().toISOString()
    };
    if (USE_SUPABASE) {
        const { error } = await supabaseClient.from('informes').update(updates).eq('id', rechazoId);
        if (error) { 
        
        await cargarInformes();
    } else {
        const db = getDB();
        const idx = db.informes.findIndex(i => i.id === rechazoId);
        db.informes[idx] = { ...db.informes[idx], ...updates };
        saveDB(db);
        await cargarInformes();
    }
    mostrarToast('Informe rechazado');
    cerrarModalRechazo();
    filtrarInformes();
    import('./dashboard.js').then(m => m.actualizarDashboard());
}

export function editarInforme(id) {
    const informe = getInforme(id);
    if (!informe) return;
    const alumno = getAlumno(informe.alumno_id);
    document.getElementById('editId').value = informe.id;
    document.getElementById('alumnoId').value = informe.alumno_id;
    document.getElementById('alumnoNombre').textContent = alumno ? `${alumno.apellido}, ${alumno.nombre}` : '';
    document.getElementById('alumnoCurso').textContent = alumno ? `${alumno.curso} ${alumno.division}` : '';
    document.getElementById('alumnoSeleccionado').classList.remove('hidden');
    document.getElementById('tipoFalta').value = informe.tipo_falta;
    document.getElementById('instancia').value = informe.instancia;
    document.getElementById('titulo').value = informe.titulo;
    document.getElementById('resumen').value = informe.resumen;
    document.getElementById('descargo').value = informe.descargo || '';
    document.getElementById('tituloForm').textContent = 'Editar Informe';
    document.getElementById('txtBtnGuardar').textContent = 'Actualizar Informe';
    cerrarModal();
    showSection('nuevo');
}
