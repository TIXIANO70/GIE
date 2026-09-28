import Chart from 'chart.js/auto';
import html2pdf from 'html2pdf.js/dist/html2pdf.bundle.min.js';
import { USE_SUPABASE, supabaseClient, GIE_URL, GIE_KEY } from './config.js';
import { getPerfil, setPerfil, esRegente, setPerfilCursos, showLogin, showApp, restoreSession, doLogout, updateAuthUI, setupLoginForm, setupLoginBanner } from './auth.js';
import { sincronizarAlumnosDesdeEdge } from './sync-alumnos-edge.js';
import './styles.css';

// ==================== ESTADO GLOBAL ====================
let alumnos = [];
let informes = [];
let usuarios = [];
let categorias = [];
let charts = {};
let anulacionId = null;
let derivacionId = null;
let calCurrentDate = new Date();
let calSelectedDate = null;
let plantillas = [];
let tabInformesActivo = 'todos'; // 'todos' | 'pendientes' | 'resueltos'
let tabAlumnosActivo = 'todos'; // 'todos' | 'mis_cursos'
let periodoTendenciaDias = 30;
let _guardandoInforme = false;
let _generandoPDF = false;
let mostrarTodosRecientes = false;
let observacionesAlumnos = [];
let tiposObservacion = [];
let alumnoActualId = null;

// IntersectionObserver para animar cards al hacer scroll (repite al subir/bajar)
const cardObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
        } else {
            entry.target.classList.remove('is-visible');
        }
    });
}, { threshold: 0.05, rootMargin: '20px 0px 20px 0px' });

// ==================== PLANTILLAS DE INFORMES ====================
const PLANTILLAS_INFORME = {
    interrupcion: {
        titulo: 'Interrupción reiterada de clase',
        instancia: 'leve',
        resumen: 'El alumno interrumpió la clase en múltiples ocasiones pese a las advertencias del docente. Se solicitó que mantenga silencio y respete los turnos de palabra, pero persistió en la conducta disruptiva.'
    },
    falta_respeto_companero: {
        titulo: 'Falta de respeto hacia un compañero',
        instancia: 'grave',
        resumen: 'Durante el recreo, el alumno utilizó un lenguaje inapropiado e irrespetuoso hacia un compañero, generando un incidente que afectó el clima del aula.'
    },
    celular_clase: {
        titulo: 'Uso de celular durante clase',
        instancia: 'leve',
        resumen: 'El alumno fue sorprendido utilizando su teléfono celular durante el desarrollo de la clase, a pesar de las normas establecidas de no uso de dispositivos.'
    },
    llegadas_tarde: {
        titulo: 'Llegadas tarde consecutivas',
        instancia: 'leve',
        resumen: 'El alumno acumula llegadas tarde sin justificación en el período evaluado. Se le ha llamado la atención en reiteradas oportunidades.'
    },
    plagio: {
        titulo: 'Plagio en trabajo práctico',
        instancia: 'grave',
        resumen: 'Se detectó que el trabajo práctico presentado por el alumno fue copiado de internet sin citar las fuentes correspondientes, infringiendo las normas de integridad académica.'
    },
    celular_evaluacion: {
        titulo: 'Uso de celular durante evaluación',
        instancia: 'muy_grave',
        resumen: 'El alumno fue sorprendido utilizando su teléfono celular durante una evaluación escrita, vulnerando la seriedad del examen y las normas de conducta establecidas.'
    },
    agresion_docente: {
        titulo: 'Agresión verbal a docente',
        instancia: 'muy_grave',
        resumen: 'El alumno dirigió insultos y expresiones ofensivas al docente al ser llamado la atención por su conducta, faltando gravemente al respeto debido.'
    },
    ausencia: {
        titulo: 'Ausencia injustificada',
        instancia: 'leve',
        resumen: 'El alumno faltó a clases sin presentar justificación válida. Se intentó contactar a los responsables sin obtener respuesta.'
    },
    grafitti: {
        titulo: 'Grafitti en baño',
        instancia: 'grave',
        resumen: 'Se identificó al alumno realizando dibujos y escrituras en las paredes del baño de varones, causando daños materiales al establecimiento.'
    },
    materiales: {
        titulo: 'Olvido de materiales reiterado',
        instancia: 'leve',
        resumen: 'El alumno olvidó los materiales necesarios para la clase por tercera vez en el período, a pesar de las recomendaciones previas.'
    },
    no_entrega: {
        titulo: 'No entrega de tarea',
        instancia: 'leve',
        resumen: 'La alumna no cumplió con la entrega del trabajo asignado dentro del plazo establecido, sin presentar justificación válida.'
    },
    alteracion: {
        titulo: 'Alteración del orden en clase',
        instancia: 'leve',
        resumen: 'El alumno generó disturbios y alteró el orden durante el desarrollo de la clase, impidiendo la normal continuidad de las actividades.'
    }
};

// --- Carga inicial de datos ---
async function cargarCategorias() {
    if (!USE_SUPABASE) return;
    const { data, error } = await supabaseClient.from('categorias').select('*').eq('activo', true).order('nombre');
    if (error) return;
    categorias = data || [];
    renderizarSelectCategorias();
}

async function cargarAlumnos() {
    if (!USE_SUPABASE) return;
    const { data, error } = await supabaseClient.from('alumnos').select('*').eq('activo', true).order('apellido');
    if (error) { mostrarToast('Error cargando alumnos', 'error'); return; }
    alumnos = data || [];
    // Alumnos cargados
    // Poblar filtro de cursos
    const cursos = [...new Set(alumnos.map(a => a.curso))].sort();
    const select = document.getElementById('filtroCurso');
    select.innerHTML = '<option value="">Todos los cursos</option>';
    cursos.forEach(c => select.innerHTML += `<option value="${c}">${c}</option>`);
    // Restaurar filtro persistido
    const savedCurso = sessionStorage.getItem('gie_filtro_filtroCurso');
    if (savedCurso) { select.value = savedCurso; }
    // Poblar filtro de divisiones (informes + alumnos)
    const divisiones = [...new Set(alumnos.map(a => a.division).filter(Boolean))].sort();
    const selectDiv = document.getElementById('filtroDivisionInformes');
    if (selectDiv) {
        selectDiv.innerHTML = '<option value="">Todas las divisiones</option>';
        divisiones.forEach(d => selectDiv.innerHTML += `<option value="${d}">${d}</option>`);
    }
    const selectDivAlumnos = document.getElementById('filtroAlumnoDivision');
    if (selectDivAlumnos) {
        const prevVal = selectDivAlumnos.value;
        selectDivAlumnos.innerHTML = '<option value="">Todas</option>';
        divisiones.forEach(d => selectDivAlumnos.innerHTML += `<option value="${d}">${d}</option>`);
        if (prevVal && divisiones.includes(prevVal)) {
            selectDivAlumnos.value = prevVal;
        }
    }
    const selectCursoAlumnos = document.getElementById('filtroAlumnoCurso');
    if (selectCursoAlumnos) {
        const prevVal = selectCursoAlumnos.value;
        selectCursoAlumnos.innerHTML = '<option value="">Todos</option>';
        cursos.forEach(c => selectCursoAlumnos.innerHTML += `<option value="${c}">${c}</option>`);
        if (prevVal && cursos.includes(prevVal)) {
            selectCursoAlumnos.value = prevVal;
        }
    }
    // Poblar filtro de turnos (informes + alumnos)
    const turnos = [...new Set(alumnos.map(a => a.turno).filter(Boolean))].sort();
    const selectTurno = document.getElementById('filtroAlumnoTurno');
    if (selectTurno) {
        selectTurno.innerHTML = '<option value="">Todos</option>';
        turnos.forEach(t => selectTurno.innerHTML += `<option value="${t}">${t}</option>`);
    }
    const selectTurnoInf = document.getElementById('filtroTurnoInformes');
    if (selectTurnoInf) {
        selectTurnoInf.innerHTML = '<option value="">Todos los turnos</option>';
        turnos.forEach(t => selectTurnoInf.innerHTML += `<option value="${t}">${t}</option>`);
    }
    // Poblar filtro de especialidades (alumnos)
    const especialidades = [...new Set(alumnos.map(a => a.especialidad).filter(e => e && e !== 'Sin especialidad'))].sort();
    const selectEspecialidad = document.getElementById('filtroAlumnoEspecialidad');
    if (selectEspecialidad) {
        const valorActual = selectEspecialidad.value;
        selectEspecialidad.innerHTML = '<option value="">Todas</option>';
        especialidades.forEach(e => selectEspecialidad.innerHTML += `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`);
        if (valorActual) selectEspecialidad.value = valorActual;
    }
}

async function cargarInformes() {
    if (!USE_SUPABASE) return;
    let query = supabaseClient.from('informes')
        .select('*, numero, alumno:alumnos(nombre, apellido, curso, division), creador:perfiles!informes_creado_por_fkey(nombre, apellido), revisor:perfiles!informes_revisado_por_fkey(nombre, apellido), fecha_reunion')
        .order('fecha_creacion', { ascending: false });
    const { data, error } = await query;
    if (error) { mostrarToast('Error cargando informes', 'error'); return; }
    informes = data || [];

    // Informes cargados
}

async function cargarTiposObservacion() {
    if (!USE_SUPABASE) return;
    const { data, error } = await supabaseClient
        .from('tipos_observacion_alumno')
        .select('*')
        .eq('activo', true)
        .order('nombre');
    if (error) return;
    tiposObservacion = data || [];
    renderizarSelectTiposObservacion();
}

async function cargarObservacionesAlumnos() {
    if (!USE_SUPABASE) return;
    const { data, error } = await supabaseClient
        .from('observaciones_alumno')
        .select('*, creador:perfiles(nombre, apellido)')
        .order('fecha_creacion', { ascending: false });
    if (error) return;
    observacionesAlumnos = data || [];
}

async function cargarUsuariosSupa() {
    if (!USE_SUPABASE) return;

    // Los perfiles con roles/cursos reales viven en GIE
    const { data: perfiles, error: errPerfiles } = await supabaseClient.from('perfiles').select('*');
    if (errPerfiles) {
        mostrarToast('Error cargando usuarios', 'error');
        return;
    }

    usuarios = (perfiles || []).map(p => ({
        id: p.id,
        email: p.email,
        nombre: p.nombre,
        apellido: p.apellido,
        rol: p.rol,
        activo: p.activo !== false,
        cursos: p.cursos || [],
        alumnos_pat: p.alumnos_pat || []
    }));

}

// --- Helpers de acceso sincrónico ---
function getAlumno(id) { return alumnos.find(a => a.id === id); }
function getInforme(id) { return informes.find(i => i.id === id); }
function getNombreUsuario(id) {
    if (!id) return 'N/A';
    const u = usuarios.find(x => x.id === id);
    return u ? `${u.apellido}, ${u.nombre}` : 'N/A';
}

// Parsea una fecha DATE de Supabase (string 'YYYY-MM-DD') sin problemas de zona horaria
function parseFechaLocal(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function getEstadoVisual(informe) {
    return informe.estado;
}

async function initGie() {
    setupLoginBanner();
    setupLoginForm(
        async () => { await iniciarApp(); },
        (error) => { mostrarToast(error, 'error'); }
    );
    setupEventListeners();

    const perfil = await restoreSession();
    if (!perfil) {
        showLogin();
        return;
    }

    await iniciarApp();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGie);
} else {
    initGie();
}

async function iniciarApp() {
    updateAuthUI();
    showApp();
    const esRegente = getPerfil()?.rol === 'regente';
    const esDOE = getPerfil()?.rol === 'doe';

    // Navegación según rol
    document.querySelectorAll('.nav-btn').forEach(btn => {
        const section = btn.dataset.section;
        if (section === 'dashboard' || section === 'estadisticas' || section === 'docentes') {
            btn.classList.toggle('hidden', !esRegente);
        }
        if (section === 'nuevo') {
            btn.classList.toggle('hidden', esDOE);
        }
    });

    // Ocultar botones de creación y tabs de filtros para DOE
    const btnNuevoInformeHeader = document.getElementById('btn-nuevo-informe');
    if (btnNuevoInformeHeader) btnNuevoInformeHeader.classList.toggle('hidden', esDOE);

    const tabsInformes = document.getElementById('tabsInformes');
    if (tabsInformes) tabsInformes.classList.toggle('hidden', esDOE);
    const esDocenteOPreceptor = getPerfil()?.rol === 'docente' || getPerfil()?.rol === 'preceptor';
    const esPAT = getPerfil()?.rol === 'pat';
    const tabsAlumnos = document.getElementById('tabsAlumnos');
    if (tabsAlumnos) tabsAlumnos.classList.toggle('hidden', !(esDocenteOPreceptor || esPAT));
    const tabMisCursos = document.getElementById('tabAlumnosMisCursos');
    if (tabMisCursos) tabMisCursos.classList.toggle('hidden', !(esDocenteOPreceptor || esPAT));
    const tabMisAlumnos = document.getElementById('tabAlumnosMisAlumnos');
    if (tabMisAlumnos) tabMisAlumnos.classList.toggle('hidden', !esPAT);
    const cardMisCursos = document.getElementById('cardMisCursos');
    if (cardMisCursos) cardMisCursos.classList.toggle('hidden', !(esDocenteOPreceptor || esPAT));
    const cardMisAlumnosPAT = document.getElementById('cardMisAlumnosPAT');
    if (cardMisAlumnosPAT) cardMisAlumnosPAT.classList.toggle('hidden', !esPAT);

    // Mostrar/ocultar items del menú según rol
    document.querySelectorAll('.nav-btn').forEach(btn => {
        const section = btn.dataset.section;
        if (section === 'dashboard' || section === 'estadisticas' || section === 'usuarios') {
            btn.classList.toggle('hidden', !esRegente);
        }
    });

    await Promise.all([cargarAlumnos(), cargarInformes(), cargarPlantillas(), cargarCategorias(), cargarUsuariosSupa(), cargarTiposObservacion(), cargarObservacionesAlumnos()]);
    initFiltros();

    // Sincronizar alumnos desde Nexus vía Edge Function en segundo plano (solo regentes)
    if (esRegente) {
        sincronizarAlumnosDesdeEdge().then(res => {
            if (res && res.sincronizados > 0) {
                cargarAlumnos().then(() => {
                    const sec = document.getElementById('alumnos');
                    if (sec && !sec.classList.contains('hidden')) {
                        filtrarAlumnos();
                    }
                });
            }
        }).catch(() => {});
    }

    if (esRegente) {
        showSection('dashboard');
        actualizarDashboard();
        ocultarSkeleton('dashboard');
    } else {
        showSection('informes');
        filtrarInformes();
        ocultarSkeleton('informes');
    }
}

function setupEventListeners() {
    document.getElementById('menuBtn').addEventListener('click', toggleSidebar);
    document.getElementById('overlay').addEventListener('click', toggleSidebar);

    // Evitar scroll/deslizamiento en el sidebar en dispositivos táctiles
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.addEventListener('touchmove', (e) => {
            e.preventDefault();
        }, { passive: false });
    }

    // Navegación lateral
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const section = btn.dataset.section;
            if (section === 'nuevo') cancelarForm();
            if (section) showSection(section);
        });
    });

    // Buscador global del header
    const headerSearchInput = document.getElementById('headerSearchInput');
    const headerSearchResults = document.getElementById('headerSearchResults');
    let headerSearchDebounce;
    if (headerSearchInput) {
        headerSearchInput.addEventListener('input', (e) => {
            clearTimeout(headerSearchDebounce);
            headerSearchDebounce = setTimeout(() => buscarGlobal(e.target.value), 200);
        });
        headerSearchInput.addEventListener('focus', () => {
            if (headerSearchInput.value.trim()) buscarGlobal(headerSearchInput.value);
        });
        headerSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') cerrarHeaderSearch();
        });
    }
    document.addEventListener('click', (e) => {
        if (!headerSearchInput || !headerSearchResults) return;
        if (!headerSearchInput.contains(e.target) && !headerSearchResults.contains(e.target)) {
            headerSearchResults.classList.add('hidden');
        }
    });

    let debounceTimer;
    const searchAlumno = document.getElementById('searchAlumno');
    const resultadosAlumno = document.getElementById('resultadosAlumno');
    if (searchAlumno) {
        searchAlumno.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => buscarAlumno(e.target.value), 300);
        });
        // Navegación por teclado en resultados de alumno
        searchAlumno.addEventListener('keydown', (e) => {
            if (!resultadosAlumno || resultadosAlumno.classList.contains('hidden')) return;
            const items = resultadosAlumno.querySelectorAll('[data-alumno-id]');
            if (items.length === 0) return;
            if (e.key === 'ArrowDown' || e.key === 'Tab') {
                e.preventDefault();
                items[0].focus();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const first = items[0];
                seleccionarAlumno(first.dataset.alumnoId, first.dataset.alumnoNombre, first.dataset.alumnoApellido, first.dataset.alumnoCurso, first.dataset.alumnoDivision, first.dataset.alumnoTurno, first.dataset.alumnoEspecialidad);
            }
        });
    }
    if (resultadosAlumno) {
        resultadosAlumno.addEventListener('keydown', (e) => {
            const items = Array.from(resultadosAlumno.querySelectorAll('[data-alumno-id]'));
            const current = document.activeElement;
            const idx = items.indexOf(current);
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (idx >= 0 && idx < items.length - 1) items[idx + 1].focus();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (idx > 0) items[idx - 1].focus();
                else if (idx === 0) searchAlumno.focus();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (idx >= 0) {
                    const item = items[idx];
                    seleccionarAlumno(item.dataset.alumnoId, item.dataset.alumnoNombre, item.dataset.alumnoApellido, item.dataset.alumnoCurso, item.dataset.alumnoDivision, item.dataset.alumnoTurno, item.dataset.alumnoEspecialidad);
                }
            } else if (e.key === 'Tab') {
                if (idx >= 0 && idx < items.length - 1) {
                    e.preventDefault();
                    items[idx + 1].focus();
                }
                // Si es el último, dejar que el Tab natural continúe al siguiente campo del formulario
            }
        });
    }

    ['filtroBusqueda', 'filtroCurso', 'filtroDivisionInformes', 'filtroTurnoInformes', 'filtroEstado', 'filtroInstancia'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const handler = () => {
            sessionStorage.setItem('gie_filtro_' + id, el.value);
            filtrarInformes();
        };
        el.addEventListener('change', handler);
        if (id === 'filtroBusqueda') el.addEventListener('input', handler);
    });

    const formInforme = document.getElementById('formInforme');
    if (formInforme) formInforme.addEventListener('submit', guardarInforme);

    const selectPlantilla = document.getElementById('plantillaInforme');
    if (selectPlantilla) {
        selectPlantilla.addEventListener('change', (e) => {
            const key = e.target.value;
            if (!key) return;
            let p = PLANTILLAS_INFORME[key];
            // Si no es predefinida, buscar en plantillas personalizadas
            if (!p && plantillas.length > 0) {
                p = plantillas.find(pl => pl.id === key);
            }
            if (!p) return;
            document.getElementById('titulo').value = p.titulo;
            document.getElementById('resumen').value = p.resumen;
            document.getElementById('instancia').value = p.instancia;
            // Hacer foco en el campo de observaciones
            document.getElementById('observaciones').focus();
        });
    }

    const modalDetalle = document.getElementById('modalDetalle');
    if (modalDetalle) {
        modalDetalle.addEventListener('click', (e) => {
            if (e.target.id === 'modalDetalle') cerrarModal();
        });
    }
    const btnCerrarModal = document.getElementById('btn-cerrar-modal');
    if (btnCerrarModal) btnCerrarModal.addEventListener('click', cerrarModal);

    const btnCerrarModalGrupo = document.getElementById('btn-cerrar-modal-grupo');
    if (btnCerrarModalGrupo) btnCerrarModalGrupo.addEventListener('click', cerrarModalGrupo);

    const btnCerrarAnulacion = document.getElementById('btn-cerrar-anulacion');
    if (btnCerrarAnulacion) btnCerrarAnulacion.addEventListener('click', cerrarModalAnulacion);

    const btnConfirmarAnulacion = document.getElementById('btn-confirmar-anulacion');
    if (btnConfirmarAnulacion) btnConfirmarAnulacion.addEventListener('click', confirmarAnulacion);

    const modalAnulacion = document.getElementById('modalAnulacion');
    if (modalAnulacion) {
        modalAnulacion.addEventListener('click', (e) => {
            if (e.target.id === 'modalAnulacion') cerrarModalAnulacion();
        });
    }

    const btnCerrarDerivacion = document.getElementById('btn-cerrar-derivacion');
    if (btnCerrarDerivacion) btnCerrarDerivacion.addEventListener('click', cerrarModalDerivacion);

    const btnConfirmarDerivacion = document.getElementById('btn-confirmar-derivacion');
    if (btnConfirmarDerivacion) btnConfirmarDerivacion.addEventListener('click', confirmarDerivacion);

    const modalDerivacion = document.getElementById('modalDerivacion');
    if (modalDerivacion) {
        modalDerivacion.addEventListener('click', (e) => {
            if (e.target.id === 'modalDerivacion') cerrarModalDerivacion();
        });
    }

    const calPrev = document.getElementById('calPrev');
    const calNext = document.getElementById('calNext');
    if (calPrev) calPrev.addEventListener('click', () => { calCurrentDate.setMonth(calCurrentDate.getMonth() - 1); calSelectedDate = null; actualizarDashboard(); });
    if (calNext) calNext.addEventListener('click', () => { calCurrentDate.setMonth(calCurrentDate.getMonth() + 1); calSelectedDate = null; actualizarDashboard(); });
    const calVerTodos = document.getElementById('calVerTodos');
    if (calVerTodos) calVerTodos.addEventListener('click', () => { calSelectedDate = null; renderCalendarioReuniones(); renderReunionesDiaSeleccionado(); });

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.addEventListener('click', logout);

    ['filtroAlumnoCurso', 'filtroAlumnoDivision', 'filtroAlumnoTurno', 'filtroAlumnoEspecialidad'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', () => {
            sessionStorage.setItem('gie_filtro_' + id, el.value);
            filtrarAlumnos();
        });
    });
    const filtroAlumnoNombre = document.getElementById('filtroAlumnoNombre');
    if (filtroAlumnoNombre) filtroAlumnoNombre.addEventListener('input', () => {
        sessionStorage.setItem('gie_filtro_filtroAlumnoNombre', filtroAlumnoNombre.value);
        filtrarAlumnos();
    });
    const ordenAlumnos = document.getElementById('ordenAlumnos');
    if (ordenAlumnos) ordenAlumnos.addEventListener('change', () => {
        sessionStorage.setItem('gie_orden_alumnos', ordenAlumnos.value);
        filtrarAlumnos();
    });

    ['filtroDocenteNombre', 'filtroDocenteRol', 'ordenDocentes'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const handler = () => filtrarDocentes();
        el.addEventListener('change', handler);
        if (id === 'filtroDocenteNombre') el.addEventListener('input', handler);
    });

    const btnVolverNuevo = document.getElementById('btn-volver-nuevo');
    if (btnVolverNuevo) btnVolverNuevo.addEventListener('click', () => showSection('informes'));

    const btnVolverAlumno = document.getElementById('btn-volver-alumno');
    if (btnVolverAlumno) btnVolverAlumno.addEventListener('click', () => showSection('alumnos'));

    const btnVolverDocente = document.getElementById('btn-volver-docente');
    if (btnVolverDocente) btnVolverDocente.addEventListener('click', () => showSection('docentes'));

    const btnNuevoInforme = document.getElementById('btn-nuevo-informe');
    if (btnNuevoInforme) btnNuevoInforme.addEventListener('click', () => {
        cancelarForm();
        showSection('nuevo');
    });

    const btnCancelarForm = document.getElementById('btn-cancelar-form');
    if (btnCancelarForm) btnCancelarForm.addEventListener('click', () => {
        cancelarForm();
        showSection('informes');
    });

    const selectInstancia = document.getElementById('instancia');
    if (selectInstancia) {
        selectInstancia.addEventListener('change', () => {
            selectInstancia.required = true;
        });
    }

    // Suscripción realtime (solo Supabase)
    if (USE_SUPABASE) {
        supabaseClient.channel('informes_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'informes' }, async () => {
                await cargarInformes();
                if (!document.getElementById('informes').classList.contains('hidden')) filtrarInformes();
                if (!document.getElementById('dashboard').classList.contains('hidden')) actualizarDashboard();
            })
            .subscribe();
    }
}

// ==================== NAVEGACIÓN ====================
function mostrarSkeleton(sectionId) {
    const skeleton = document.getElementById('skeleton-' + sectionId);
    const content = document.getElementById('content-' + sectionId);
    if (skeleton) skeleton.classList.remove('hidden');
    if (content) content.classList.add('hidden');
}

function ocultarSkeleton(sectionId) {
    const skeleton = document.getElementById('skeleton-' + sectionId);
    const content = document.getElementById('content-' + sectionId);
    if (skeleton) skeleton.classList.add('hidden');
    if (content) content.classList.remove('hidden');
}

const SECTION_TITLES = {
    dashboard: 'Dashboard',
    nuevo: 'Nuevo Informe',
    informes: 'Informes',
    alumnos: 'Alumnos',
    docentes: 'Docentes',
    usuarios: 'Usuarios',
    estadisticas: 'Estadísticas',
    ajustes: 'Ajustes',
    vistaAlumno: 'Alumno',
    vistaDocente: 'Docente'
};

function showSection(sectionId) {
    const target = document.getElementById(sectionId);
    if (!target || !target.classList.contains('hidden')) return;
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    target.classList.remove('hidden');

    const headerTitle = document.getElementById('headerSectionTitle');
    if (headerTitle) headerTitle.textContent = SECTION_TITLES[sectionId] || sectionId;

    document.querySelectorAll('.nav-btn').forEach(b => {
        if (b.dataset.section === sectionId) b.classList.add('bg-slate-800', 'text-blue-400');
        else b.classList.remove('bg-slate-800', 'text-blue-400');
    });
    if (sectionId === 'estadisticas') {
        mostrarSkeleton('estadisticas');
        requestAnimationFrame(() => {
            setTimeout(() => {
                ocultarSkeleton('estadisticas');
                setTimeout(() => {
                    cargarEstadisticas();
                }, 300);
            }, 50);
        });
    }
    if (sectionId === 'docentes') { mostrarSkeleton('docentes'); cargarDocentes().then(() => ocultarSkeleton('docentes')); }
    if (sectionId === 'usuarios') { mostrarSkeleton('usuarios'); cargarUsuarios().then(() => ocultarSkeleton('usuarios')); }
    if (sectionId === 'dashboard') { mostrarSkeleton('dashboard'); actualizarDashboard(); ocultarSkeleton('dashboard'); }
    if (sectionId === 'ajustes') {
        mostrarSkeleton('ajustes');
        _cursosAjustes = [...(getPerfil()?.cursos || [])];
        renderizarChipsCursos('ajustesCursosLista', _cursosAjustes, 'quitarMiCurso');
        renderizarChipsAlumnosPAT('ajustesAlumnosPATLista', getPerfil()?.alumnos_pat || [], 'quitarAlumnoPAT');
        cargarEspacioBD().then(() => ocultarSkeleton('ajustes'));
    }
    if (sectionId === 'informes') {
        mostrarSkeleton('informes');
        requestAnimationFrame(() => {
            setTimeout(() => {
                ['filtroBusqueda', 'filtroCurso', 'filtroDivisionInformes', 'filtroTurnoInformes', 'filtroEstado', 'filtroInstancia'].forEach(id => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    const saved = sessionStorage.getItem('gie_filtro_' + id);
                    if (saved !== null && el.value !== saved) el.value = saved;
                });
                const savedTab = sessionStorage.getItem('gie_tab_informes');
                if (savedTab && savedTab !== tabInformesActivo) {
                    tabInformesActivo = savedTab;
                }
                actualizarTabsInformes();
                filtrarInformes();
                ocultarSkeleton('informes');
            }, 50);
        });
    }
    if (sectionId === 'alumnos') {
        mostrarSkeleton('alumnos');
        requestAnimationFrame(() => {
            setTimeout(() => {
                ['filtroAlumnoCurso', 'filtroAlumnoDivision', 'filtroAlumnoTurno', 'filtroAlumnoEspecialidad', 'filtroAlumnoNombre'].forEach(id => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    const saved = sessionStorage.getItem('gie_filtro_' + id);
                    if (saved !== null && el.value !== saved) el.value = saved;
                });
                const ordenEl = document.getElementById('ordenAlumnos');
                if (ordenEl) {
                    const savedOrden = sessionStorage.getItem('gie_orden_alumnos');
                    if (savedOrden !== null && ordenEl.value !== savedOrden) ordenEl.value = savedOrden;
                }
                const savedTabAlumnos = sessionStorage.getItem('gie_tab_alumnos');
                const esDocenteOPreceptor = getPerfil()?.rol === 'docente' || getPerfil()?.rol === 'preceptor';
                const esPAT = getPerfil()?.rol === 'pat';
                const misCursos = getPerfil()?.cursos || [];

                if (esRegente()) {
                    tabAlumnosActivo = 'todos';
                } else if (savedTabAlumnos && (savedTabAlumnos !== 'mis_cursos' || misCursos.length > 0)) {
                    tabAlumnosActivo = savedTabAlumnos;
                } else if (esDocenteOPreceptor && misCursos.length > 0) {
                    tabAlumnosActivo = 'mis_cursos';
                } else {
                    tabAlumnosActivo = 'todos';
                }
                sessionStorage.setItem('gie_tab_alumnos', tabAlumnosActivo);
                actualizarTabsAlumnos();
                filtrarAlumnos();
                ocultarSkeleton('alumnos');
            }, 50);
        });
    }
    if (window.innerWidth < 1024) {
        document.getElementById('sidebar').classList.add('sidebar-hidden');
        document.getElementById('overlay').classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
    }
    window.scrollTo(0,0);
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const isOpening = sidebar.classList.contains('sidebar-hidden');
    sidebar.classList.toggle('sidebar-hidden');
    document.getElementById('overlay').classList.toggle('hidden');
    if (isOpening) {
        document.body.classList.add('overflow-hidden');
    } else {
        document.body.classList.remove('overflow-hidden');
    }
}

let _logoutCountdownInterval = null;

async function logout() {
    mostrarModalLogout();
}

function mostrarModalLogout() {
    const modal = document.getElementById('modalLogout');
    const btn = document.getElementById('btn-confirmar-logout');
    const countdownEl = document.getElementById('logoutCountdown');
    if (!modal || !btn || !countdownEl) return;

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');
    btn.classList.remove('hover:bg-red-700');

    let segundos = 5;
    countdownEl.textContent = segundos;

    if (_logoutCountdownInterval) clearInterval(_logoutCountdownInterval);
    _logoutCountdownInterval = setInterval(() => {
        segundos--;
        countdownEl.textContent = segundos;
        if (segundos <= 0) {
            clearInterval(_logoutCountdownInterval);
            btn.disabled = false;
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
            btn.classList.add('hover:bg-red-700');
            btn.innerHTML = 'Cerrar sesión';
        }
    }, 1000);
}

window.cerrarModalLogout = function() {
    const modal = document.getElementById('modalLogout');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    if (_logoutCountdownInterval) {
        clearInterval(_logoutCountdownInterval);
        _logoutCountdownInterval = null;
    }
    // Restaurar texto del botón para la próxima vez
    const btn = document.getElementById('btn-confirmar-logout');
    if (btn) {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        btn.innerHTML = 'Cerrar (<span id="logoutCountdown">5</span>)';
    }
};

window.confirmarLogout = async function() {
    cerrarModalLogout();
    await doLogout();
    alumnos = [];
    informes = [];
    usuarios = [];
    document.getElementById('sidebar').classList.add('sidebar-hidden');
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('loginForm').reset();
};

// ==================== UTILIDADES / SEGURIDAD ====================

/**
 * Escapa caracteres HTML peligrosos para prevenir XSS.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/`/g, '&#96;');
}

/**
 * Escapa un valor para usarlo dentro de un atributo HTML entre comillas dobles.
 * @param {string} text
 * @returns {string}
 */
function escapeAttr(text) {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Escapa un valor para usarlo dentro de una cadena JavaScript inline (onclick, etc.).
 * @param {string} text
 * @returns {string}
 */
function escapeJsString(text) {
    if (text == null) return '';
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

function formatearFecha(fecha) {
    if (!fecha) return 'N/A';
    return new Date(fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatearFechaCorta(fecha) {
    if (!fecha) return 'N/A';
    return new Date(fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function generarId() { return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2); }
function mostrarToast(mensaje, tipo = 'success') {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toastIcon');
    const msg = document.getElementById('toastMsg');
    msg.textContent = mensaje;
    const iconMap = {
        error: 'mdi mdi-alert-circle-outline text-red-400',
        info: 'mdi mdi-loading animate-spin text-blue-400',
        success: 'mdi mdi-check-circle-outline text-green-400'
    };
    icon.className = iconMap[tipo] || iconMap.success;
    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 3000);
}

// ==================== ALUMNOS ====================
function initFiltros() {
    // Ya se poblaron en cargarAlumnos
}

function buscarAlumno(query) {
    const resultados = document.getElementById('resultadosAlumno');
    if (!query || query.length < 1) { resultados.classList.add('hidden'); return; }
    const filtrados = alumnos.filter(a =>
        `${a.nombre} ${a.apellido}`.toLowerCase().includes(query.toLowerCase()) ||
        `${a.apellido} ${a.nombre}`.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 10);
    if (filtrados.length === 0) {
        resultados.innerHTML = '<div class="p-3 text-sm text-slate-500">No se encontraron alumnos</div>';
    } else {
        resultados.innerHTML = filtrados.map(a => `
            <div tabindex="0"
                data-alumno-id="${a.id}"
                data-alumno-nombre="${escapeAttr(a.nombre)}"
                data-alumno-apellido="${escapeAttr(a.apellido)}"
                data-alumno-curso="${escapeAttr(a.curso)}"
                data-alumno-division="${escapeAttr(a.division)}"
                data-alumno-turno="${escapeAttr(a.turno || '')}"
                data-alumno-especialidad="${escapeAttr(a.especialidad || '')}"
                onclick="seleccionarAlumno('${a.id}', '${escapeJsString(a.nombre)}', '${escapeJsString(a.apellido)}', '${escapeJsString(a.curso)}', '${escapeJsString(a.division)}', '${escapeJsString(a.turno || '')}', '${escapeJsString(a.especialidad || '')}')"
                class="p-3 hover:bg-slate-50 focus:bg-blue-50 cursor-pointer border-b border-slate-100 last:border-0 outline-none">
                <p class="font-medium text-sm">${escapeHtml(a.apellido)}, ${escapeHtml(a.nombre)}</p>
                <p class="text-xs text-slate-500">${escapeHtml(a.curso)} ${escapeHtml(a.division)}${a.turno ? ' · ' + escapeHtml(a.turno) : ''}${a.especialidad && a.especialidad !== 'Sin especialidad' ? ' · ' + escapeHtml(a.especialidad) : ''}</p>
            </div>`).join('');
    }
    resultados.classList.remove('hidden');
}

function buscarGlobal(query) {
    const input = document.getElementById('headerSearchInput');
    const dropdown = document.getElementById('headerSearchResults');
    if (!input || !dropdown) return;

    query = (query || '').toLowerCase().trim();
    if (!query) {
        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
        return;
    }

    const maxPorCategoria = 5;
    const resultados = [];

    // Alumnos
    const alumnosMatch = alumnos.filter(a =>
        `${a.nombre || ''} ${a.apellido || ''}`.toLowerCase().includes(query) ||
        `${a.apellido || ''}, ${a.nombre || ''}`.toLowerCase().includes(query) ||
        (a.curso || '').toLowerCase().includes(query) ||
        (a.division || '').toLowerCase().includes(query) ||
        (a.dni && String(a.dni).includes(query))
    ).slice(0, maxPorCategoria);

    // Informes
    const informesMatch = informes.filter(i => {
        const alumno = getAlumno(i.alumno_id);
        return (i.titulo || '').toLowerCase().includes(query) ||
               (i.resumen || '').toLowerCase().includes(query) ||
               (i.numero && String(i.numero).includes(query)) ||
               `${alumno?.apellido || ''} ${alumno?.nombre || ''}`.toLowerCase().includes(query);
    }).slice(0, maxPorCategoria);

    // Usuarios / Docentes
    const usuariosMatch = usuarios.filter(u =>
        `${u.nombre || ''} ${u.apellido || ''}`.toLowerCase().includes(query) ||
        `${u.apellido || ''}, ${u.nombre || ''}`.toLowerCase().includes(query) ||
        (u.email || '').toLowerCase().includes(query) ||
        (u.rol || '').toLowerCase().includes(query)
    ).slice(0, maxPorCategoria);

    const secciones = [];

    if (alumnosMatch.length) {
        secciones.push({
            titulo: 'Alumnos',
            icono: 'mdi-school-outline',
            items: alumnosMatch.map(a => ({
                label: `${escapeHtml(a.apellido)}, ${escapeHtml(a.nombre)}`,
                meta: `${escapeHtml(a.curso || '')} ${escapeHtml(a.division || '')}`,
                onClick: () => { verAlumno(a.id); cerrarHeaderSearch(); }
            }))
        });
    }

    if (informesMatch.length) {
        secciones.push({
            titulo: 'Informes',
            icono: 'mdi-file-document-outline',
            items: informesMatch.map(i => {
                const alumno = getAlumno(i.alumno_id);
                return {
                    label: escapeHtml(i.titulo || 'Sin título'),
                    meta: alumno ? `${escapeHtml(alumno.apellido)}, ${escapeHtml(alumno.nombre)}` : 'Alumno desconocido',
                    onClick: () => { verDetalle(i.id); cerrarHeaderSearch(); }
                };
            })
        });
    }

    if (usuariosMatch.length) {
        secciones.push({
            titulo: 'Docentes / Usuarios',
            icono: 'mdi-human-male-board',
            items: usuariosMatch.map(u => ({
                label: `${escapeHtml(u.apellido || '')}, ${escapeHtml(u.nombre || '')}`,
                meta: escapeHtml(u.email || ''),
                onClick: () => { verDocente(u.id); cerrarHeaderSearch(); }
            }))
        });
    }

    if (secciones.length === 0) {
        dropdown.innerHTML = `
            <div class="px-4 py-6 text-center">
                <i class="mdi mdi-magnify text-slate-300 text-2xl mb-2"></i>
                <p class="text-sm text-slate-500">No se encontraron resultados</p>
            </div>
        `;
        dropdown.classList.remove('hidden');
        return;
    }

    dropdown.innerHTML = secciones.map(sec => `
        <div class="px-3 py-2">
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                <i class="mdi ${sec.icono}"></i> ${escapeHtml(sec.titulo)}
            </p>
            ${sec.items.map(item => `
                <button class="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors">
                    <p class="text-sm font-medium text-slate-700">${item.label}</p>
                    <p class="text-xs text-slate-500">${item.meta}</p>
                </button>
            `).join('')}
        </div>
    `).join('');

    // Asignar event listeners a los botones generados
    let idx = 0;
    secciones.forEach(sec => {
        sec.items.forEach(item => {
            const btn = dropdown.querySelectorAll('button')[idx];
            if (btn) btn.addEventListener('click', item.onClick);
            idx++;
        });
    });

    dropdown.classList.remove('hidden');
}

function cerrarHeaderSearch() {
    const input = document.getElementById('headerSearchInput');
    const dropdown = document.getElementById('headerSearchResults');
    if (input) input.value = '';
    if (dropdown) {
        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
    }
}

function seleccionarAlumno(id, nombre, apellido, curso, division, turno = '', especialidad = '') {
    document.getElementById('alumnoId').value = id;
    document.getElementById('alumnoNombre').textContent = `${apellido}, ${nombre}`;
    document.getElementById('alumnoCurso').textContent = `${curso} ${division}${turno ? ' · ' + turno : ''}${especialidad && especialidad !== 'Sin especialidad' ? ' · ' + especialidad : ''}`;
    document.getElementById('alumnoSeleccionado').classList.remove('hidden');
    document.getElementById('resultadosAlumno').classList.add('hidden');
    document.getElementById('searchAlumno').value = '';
    document.getElementById('buscadorAlumno').classList.add('hidden');
    document.getElementById('btn-cambiar-alumno').classList.remove('hidden');
}

function limpiarAlumno() {
    document.getElementById('alumnoId').value = '';
    document.getElementById('alumnoSeleccionado').classList.add('hidden');
    document.getElementById('buscadorAlumno').classList.remove('hidden');
    document.getElementById('btn-cambiar-alumno').classList.add('hidden');
    document.getElementById('searchAlumno').focus();
}

// ==================== ALUMNOS - LISTADO ====================
function filtrarAlumnos() {
    const curso = document.getElementById('filtroAlumnoCurso')?.value || '';
    const division = document.getElementById('filtroAlumnoDivision')?.value || '';
    const turno = document.getElementById('filtroAlumnoTurno')?.value || '';
    const especialidad = document.getElementById('filtroAlumnoEspecialidad')?.value || '';
    const nombre = document.getElementById('filtroAlumnoNombre')?.value.toLowerCase().trim() || '';
    const orden = document.getElementById('ordenAlumnos')?.value || 'informes_desc';
    const misCursos = getPerfil()?.cursos || [];

    // Eliminar duplicados por ID (defensa contra datos corruptos)
    const unicos = [...new Map(alumnos.map(a => [a.id, a])).values()];

    const esPAT = getPerfil()?.rol === 'pat';
    const misAlumnosPAT = getPerfil()?.alumnos_pat || [];
    const filtrados = unicos.filter(a => {
        const matchCurso = !curso || a.curso === curso;
        const matchDivision = !division || a.division === division;
        const matchTurno = !turno || a.turno === turno;
        const matchEspecialidad = !especialidad || a.especialidad === especialidad;
        const matchNombre = !nombre ||
            `${a.nombre} ${a.apellido}`.toLowerCase().includes(nombre) ||
            `${a.apellido} ${a.nombre}`.toLowerCase().includes(nombre);
        const matchMisCursos = tabAlumnosActivo !== 'mis_cursos' || misCursos.includes(`${a.curso || ''}${a.division || ''}`);
        const matchMisAlumnos = tabAlumnosActivo !== 'mis_alumnos' || misAlumnosPAT.includes(a.id);
        return matchCurso && matchDivision && matchTurno && matchEspecialidad && matchNombre && matchMisCursos && matchMisAlumnos;
    });

    // Calcular cantidad de informes por alumno para ordenamiento
    const informesPorAlumno = {};
    informes.forEach(i => {
        informesPorAlumno[i.alumno_id] = (informesPorAlumno[i.alumno_id] || 0) + 1;
    });

    const numCurso = c => {
        const n = parseInt(c, 10);
        return isNaN(n) ? 0 : n;
    };

    filtrados.sort((a, b) => {
        switch (orden) {
            case 'informes_desc': {
                const ca = informesPorAlumno[a.id] || 0;
                const cb = informesPorAlumno[b.id] || 0;
                if (cb !== ca) return cb - ca;
                return `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`);
            }
            case 'informes_asc': {
                const ca = informesPorAlumno[a.id] || 0;
                const cb = informesPorAlumno[b.id] || 0;
                if (ca !== cb) return ca - cb;
                return `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`);
            }
            case 'apellido_asc':
                return `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`);
            case 'apellido_desc':
                return `${b.apellido} ${b.nombre}`.localeCompare(`${a.apellido} ${a.nombre}`);
            case 'nombre_asc':
                return `${a.nombre} ${a.apellido}`.localeCompare(`${b.nombre} ${b.apellido}`);
            case 'curso_asc': {
                const na = numCurso(a.curso);
                const nb = numCurso(b.curso);
                if (na !== nb) return na - nb;
                return (a.division || '').localeCompare(b.division || '');
            }
            case 'curso_desc': {
                const na = numCurso(a.curso);
                const nb = numCurso(b.curso);
                if (nb !== na) return nb - na;
                return (b.division || '').localeCompare(a.division || '');
            }
            default:
                return 0;
        }
    });

    renderizarAlumnos(filtrados, informesPorAlumno);
}

function renderizarAlumnos(lista, informesPorAlumno) {
    const container = document.getElementById('listaAlumnos');
    const empty = document.getElementById('alumnosEmpty');
    if (!container) return;

    if (lista.length === 0) {
        container.innerHTML = '';
        empty?.classList.remove('hidden');
        return;
    }
    empty?.classList.add('hidden');

    container.innerHTML = lista.map(a => {
        const cant = informesPorAlumno[a.id] || 0;
        const turnoColor = a.turno === 'Mañana' ? 'bg-amber-100 text-amber-700' : a.turno === 'Tarde' ? 'bg-orange-100 text-orange-700' : 'bg-indigo-100 text-indigo-700';
        return `
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 hover:shadow-md transition-shadow cursor-pointer card-scroll" onclick="verAlumno('${a.id}')">
            <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
                    ${escapeHtml(a.nombre[0])}${escapeHtml(a.apellido[0])}
                </div>
                <div class="flex-1 min-w-0">
                    <h3 class="font-semibold text-slate-800 text-sm">${escapeHtml(a.apellido)}, ${escapeHtml(a.nombre)}</h3>
                    <div class="flex items-center gap-2 mt-0.5">
                        <p class="text-xs text-slate-500">${escapeHtml(a.curso)} ${escapeHtml(a.division)}</p>
                        ${a.turno ? `<span class="text-[10px] px-1.5 py-0.5 rounded font-medium ${turnoColor}">${escapeHtml(a.turno)}</span>` : ''}
                        ${a.especialidad && a.especialidad !== 'Sin especialidad' ? `<span class="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700">${escapeHtml(a.especialidad)}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="flex items-center justify-between pt-3 border-t border-slate-100">
                <span class="text-xs ${cant > 0 ? 'text-amber-600 font-semibold' : 'text-slate-500'}">${cant} informe${cant !== 1 ? 's' : ''}</span>
                <span class="text-xs text-blue-600 font-medium">Ver historial <i class="mdi mdi-arrow-right text-xs"></i></span>
            </div>
        </div>
    `}).join('');
    container.querySelectorAll('.card-scroll').forEach(card => cardObserver.observe(card));
}

// ==================== INFORMES - CRUD ====================
function actualizarTabsInformes() {
    const tabs = {
        todos: document.getElementById('tabTodos'),
        pendientes: document.getElementById('tabPendientes'),
        revisados: document.getElementById('tabRevisados'),
        derivados: document.getElementById('tabDerivados'),
        archivados: document.getElementById('tabArchivados'),
        anulados: document.getElementById('tabAnulados')
    };
    Object.entries(tabs).forEach(([key, btn]) => {
        if (!btn) return;
        if (key === tabInformesActivo) {
            btn.classList.remove('bg-slate-100', 'text-slate-600', 'hover:bg-slate-200');
            btn.classList.add('bg-blue-600', 'text-white');
        } else {
            btn.classList.remove('bg-blue-600', 'text-white');
            btn.classList.add('bg-slate-100', 'text-slate-600', 'hover:bg-slate-200');
        }
    });
}

window.setTabInformes = function(tab) {
    tabInformesActivo = tab;
    mostrarTodosRecientes = false;
    sessionStorage.setItem('gie_tab_informes', tab);
    actualizarTabsInformes();
    filtrarInformes();
};

window.toggleMostrarMasRecientes = function() {
    mostrarTodosRecientes = !mostrarTodosRecientes;
    filtrarInformes();
};

window.setTabAlumnos = function(tab) {
    tabAlumnosActivo = tab;
    sessionStorage.setItem('gie_tab_alumnos', tab);
    actualizarTabsAlumnos();
    filtrarAlumnos();
};

function actualizarTabsAlumnos() {
    const activeId = tabAlumnosActivo === 'mis_cursos' ? 'tabAlumnosMisCursos'
        : tabAlumnosActivo === 'mis_alumnos' ? 'tabAlumnosMisAlumnos'
        : 'tabAlumnosTodos';
    document.querySelectorAll('.tab-alumnos').forEach(btn => {
        const isActive = btn.id === activeId;
        btn.classList.toggle('bg-blue-600', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('bg-slate-100', !isActive);
        btn.classList.toggle('text-slate-600', !isActive);
        btn.classList.toggle('hover:bg-slate-200', !isActive);
    });
}

function filtrarInformes() {
    const busqueda = document.getElementById('filtroBusqueda').value.toLowerCase();
    const curso = document.getElementById('filtroCurso').value;
    const division = document.getElementById('filtroDivisionInformes')?.value || '';
    const turno = document.getElementById('filtroTurnoInformes')?.value || '';
    const estado = document.getElementById('filtroEstado').value;
    const instancia = document.getElementById('filtroInstancia').value;
    const esRegente = getPerfil()?.rol === 'regente';
    const esDOE = getPerfil()?.rol === 'doe';
    const esPAT = getPerfil()?.rol === 'pat';
    const misAlumnosPAT = getPerfil()?.alumnos_pat || [];
    const filtrados = informes.filter(i => {
        const alumno = getAlumno(i.alumno_id);
        const matchBusqueda = !busqueda ||
            `${alumno?.apellido || ''} ${alumno?.nombre || ''}`.toLowerCase().includes(busqueda) ||
            i.titulo.toLowerCase().includes(busqueda) ||
            i.resumen.toLowerCase().includes(busqueda) ||
            (i.numero !== null && i.numero !== undefined && i.numero.toString().includes(busqueda));
        const matchCurso = !curso || (alumno && alumno.curso === curso);
        const matchDivision = !division || (alumno && alumno.division === division);
        const matchTurno = !turno || (alumno && alumno.turno === turno);
        const matchEstado = !estado || i.estado === estado;
        const matchInstancia = !instancia || i.instancia === instancia;
        // Regente ve todo; DOE ve derivados a él + archivados + anulados; Doc/Precep ve suyos + derivados a él; PAT ve sus alumnos + suyos + derivados a él
        const perfilId = getPerfil()?.id;
        const rol = getPerfil()?.rol;
        const esDestinatario = i.derivado_a === perfilId;
        const matchCreador = esRegente
            || (rol === 'doe' && (esDestinatario || i.estado === 'archivado' || i.estado === 'anulado'))
            || (rol === 'docente' && (i.creado_por === perfilId || esDestinatario))
            || (rol === 'preceptor' && (i.creado_por === perfilId || esDestinatario))
            || (rol === 'pat' && (i.creado_por === perfilId || esDestinatario || misAlumnosPAT.includes(i.alumno_id)));
        // Filtro rápido por tab
        const matchTab = tabInformesActivo === 'todos' ? true :
            tabInformesActivo === 'pendientes' ? i.estado === 'pendiente' :
            tabInformesActivo === 'revisados' ? i.estado === 'revisado' :
            tabInformesActivo === 'derivados' ? i.estado === 'derivado' :
            tabInformesActivo === 'archivados' ? i.estado === 'archivado' :
            tabInformesActivo === 'anulados' ? i.estado === 'anulado' :
            false;
        return matchBusqueda && matchCurso && matchDivision && matchTurno && matchEstado && matchInstancia && matchCreador && matchTab;
    });

    // Actualizar badges (filtrados por creador también para docentes/PAT)
    const baseFiltrados = informes.filter(i => {
        const alumno = getAlumno(i.alumno_id);
        const matchBusqueda = !busqueda ||
            `${alumno?.apellido || ''} ${alumno?.nombre || ''}`.toLowerCase().includes(busqueda) ||
            i.titulo.toLowerCase().includes(busqueda) ||
            i.resumen.toLowerCase().includes(busqueda) ||
            (i.numero !== null && i.numero !== undefined && i.numero.toString().includes(busqueda));
        const matchCurso = !curso || (alumno && alumno.curso === curso);
        const matchDivision = !division || (alumno && alumno.division === division);
        const matchTurno = !turno || (alumno && alumno.turno === turno);
        const matchEstado = !estado || i.estado === estado;
        const matchInstancia = !instancia || i.instancia === instancia;
        const perfilId = getPerfil()?.id;
        const rol = getPerfil()?.rol;
        const esDestinatario = i.derivado_a === perfilId;
        const matchCreador = esRegente
            || (rol === 'doe' && (esDestinatario || i.estado === 'archivado' || i.estado === 'anulado'))
            || (rol === 'docente' && (i.creado_por === perfilId || esDestinatario))
            || (rol === 'preceptor' && (i.creado_por === perfilId || esDestinatario))
            || (rol === 'pat' && (i.creado_por === perfilId || esDestinatario || misAlumnosPAT.includes(i.alumno_id)));
        return matchBusqueda && matchCurso && matchDivision && matchTurno && matchEstado && matchInstancia && matchCreador;
    });
    const badgeTodos = document.getElementById('badgeTodos');
    const badgePendientes = document.getElementById('badgePendientes');
    const badgeRevisados = document.getElementById('badgeRevisados');
    const badgeDerivados = document.getElementById('badgeDerivados');
    const badgeArchivados = document.getElementById('badgeArchivados');
    const badgeAnulados = document.getElementById('badgeAnulados');
    if (badgeTodos) badgeTodos.textContent = baseFiltrados.length;
    if (badgePendientes) badgePendientes.textContent = baseFiltrados.filter(i => i.estado === 'pendiente').length;
    if (badgeRevisados) badgeRevisados.textContent = baseFiltrados.filter(i => i.estado === 'revisado').length;
    if (badgeDerivados) badgeDerivados.textContent = baseFiltrados.filter(i => i.estado === 'derivado').length;
    if (badgeArchivados) badgeArchivados.textContent = baseFiltrados.filter(i => i.estado === 'archivado').length;
    if (badgeAnulados) badgeAnulados.textContent = baseFiltrados.filter(i => i.estado === 'anulado').length;

    // Ordenar según pestaña activa: en revisados/derivados/finalizados usar fecha_revision (más reciente primero)
    filtrados.sort((a, b) => {
        const usarFechaRevision = ['revisados', 'derivados', 'finalizados'].includes(tabInformesActivo);
        const fechaA = new Date(usarFechaRevision ? (a.fecha_revision || a.fecha_creacion) : a.fecha_creacion);
        const fechaB = new Date(usarFechaRevision ? (b.fecha_revision || b.fecha_creacion) : b.fecha_creacion);
        return fechaB - fechaA;
    });

    renderizarInformes(filtrados);
}

function renderCardInforme(i) {
    const alumno = getAlumno(i.alumno_id);
    const esRegente = getPerfil()?.rol === 'regente';
    const estadoVisual = i.estado;
    const accionesRapidas = (esRegente && i.estado === 'pendiente') ? `
        <div class="flex gap-2 mt-3 pt-3 border-t border-slate-100">
            <button onclick="event.stopPropagation(); verDetalle('${i.id}')" class="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1">
                <i class="mdi mdi-eye-outline"></i> Revisar
            </button>
            <button onclick="event.stopPropagation(); accionRapidaAnular('${i.id}', this)" class="flex-1 bg-red-50 hover:bg-red-100 text-red-700 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1">
                <i class="mdi mdi-cancel"></i> Anular
            </button>
        </div>` : '';
    return `
    <div id="item-${i.id}" class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 cursor-pointer hover:shadow-md transition-all instancia-${escapeAttr(i.instancia)} card-scroll">
        <div class="flex flex-col sm:flex-row justify-between items-start gap-3" onclick="verDetalle('${i.id}')">
            <div class="flex-1">
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                    <span class="status-${escapeAttr(estadoVisual)} px-2 py-0.5 rounded-full text-xs font-medium capitalize">${escapeHtml(estadoVisual.replace('_', ' '))}</span>
                    <span class="text-xs text-slate-500">${formatearFechaCorta(i.fecha_creacion)}</span>
                    ${i.numero !== null && i.numero !== undefined ? `<span class="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">Informe N° ${escapeHtml(i.numero)}</span>` : `<span class="text-xs text-red-500 italic">Sin numerar</span>`}
                </div>
                <h3 class="font-semibold text-slate-800 mb-1">${escapeHtml(i.titulo)}</h3>
                <p class="text-sm text-slate-600 mb-2"><i class="mdi mdi-account-outline mr-1"></i>${alumno ? `${escapeHtml(alumno.apellido)}, ${escapeHtml(alumno.nombre)}` : 'Desconocido'} • ${alumno ? `${escapeHtml(alumno.curso)} ${escapeHtml(alumno.division)}${alumno.turno ? ' · ' + escapeHtml(alumno.turno) : ''}${alumno.especialidad && alumno.especialidad !== 'Sin especialidad' ? ' · ' + escapeHtml(alumno.especialidad) : ''}` : ''}</p>
                ${i.estado === 'derivado' && i.derivado_a ? `<p class="text-sm text-green-600 mb-2"><i class="mdi mdi-share-variant-outline mr-1"></i>Derivado a ${escapeHtml(getNombreUsuario(i.derivado_a))}</p>` : ''}
                <p class="text-sm text-slate-500 line-clamp-2">${escapeHtml(i.resumen)}</p>
            </div>
            <div class="flex items-center gap-2">
                ${['muy_grave','consejo_aula','consejo'].includes(i.instancia) ? `<i class="mdi mdi-alert-outline ${i.instancia === 'muy_grave' ? 'text-red-500' : i.instancia === 'consejo_aula' ? 'text-pink-600' : 'text-purple-600'}" title="${i.instancia === 'muy_grave' ? 'Muy Grave' : i.instancia === 'consejo_aula' ? 'Consejo de Aula' : 'Consejo Escolar'}"></i>` : ''}
                <i class="mdi mdi-chevron-right text-slate-400"></i>
            </div>
        </div>
        ${accionesRapidas}
    </div>`;
}

function renderizarInformes(lista) {
    const contenedor = document.getElementById('listaInformes');
    const sinResultados = document.getElementById('sinResultados');
    if (lista.length === 0) { contenedor.innerHTML = ''; sinResultados.classList.remove('hidden'); return; }
    sinResultados.classList.add('hidden');

    // Ordenar por fecha más reciente (revisión o creación)
    const ordenados = lista.slice().sort((a, b) => {
        const fechaA = new Date(a.fecha_revision || a.fecha_creacion);
        const fechaB = new Date(b.fecha_revision || b.fecha_creacion);
        return fechaB - fechaA;
    });

    // Recientes: máx 3 o todos si se expandió
    const limiteRecientes = mostrarTodosRecientes ? ordenados.length : 3;
    const recientes = ordenados.slice(0, limiteRecientes);

    // Título y estilo según tab activo
    const tituloTabMap = {
        todos: { titulo: 'Todos', clase: 'bg-slate-100 text-slate-600' },
        pendientes: { titulo: 'Pendientes', clase: 'bg-amber-100 text-amber-700' },
        revisados: { titulo: 'Revisados', clase: 'bg-blue-100 text-blue-700' },
        derivados: { titulo: 'Derivados', clase: 'bg-green-100 text-green-700' },
        archivados: { titulo: 'Archivados', clase: 'bg-slate-100 text-slate-600' },
        anulados: { titulo: 'Anulados', clase: 'bg-red-100 text-red-700' }
    };
    const tabInfo = tituloTabMap[tabInformesActivo] || tituloTabMap.todos;

    let html = '';

    // Sección RECIENTES
    if (recientes.length > 0) {
        html += `
        <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
                <h3 class="text-sm font-bold text-slate-700 uppercase tracking-wide">Recientes</h3>
                <span class="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">${recientes.length}</span>
            </div>
            ${lista.length > 3 ? `<button onclick="toggleMostrarMasRecientes()" class="text-xs text-blue-600 hover:text-blue-800 font-medium">${mostrarTodosRecientes ? 'Mostrar menos recientes' : 'Mostrar más recientes'}</button>` : ''}
        </div>
        <div class="space-y-3 mb-6">${recientes.map(renderCardInforme).join('')}</div>`;
    }

    // Sección del estado/tab elegido (todos los informes filtrados)
    html += `
    <div class="flex items-center gap-2 mb-3">
        <h3 class="text-sm font-bold text-slate-700 uppercase tracking-wide">${tabInfo.titulo}</h3>
        <span class="text-xs ${tabInfo.clase} px-2 py-0.5 rounded-full font-semibold">${ordenados.length}</span>
    </div>
    <div class="space-y-3">${ordenados.map(renderCardInforme).join('')}</div>`;

    contenedor.innerHTML = html;
    contenedor.querySelectorAll('.card-scroll').forEach(card => cardObserver.observe(card));
}

window.accionRapidaAnular = function(id, btn) {
    const item = document.getElementById('item-' + id);
    if (!item) return;
    window._anulacionItemId = id;
    window._anulacionItemEl = item;
    mostrarAnulacion(id);
};

window.revisarDesdeDashboard = async function(id, btn) {
    const item = document.getElementById('dash-item-' + id);
    if (!item) return;
    btn.innerHTML = '<span class="btn-spinner"></span>';
    btn.disabled = true;
    await new Promise(r => setTimeout(r, 300));
    item.classList.add('animate-slide-out');
    await new Promise(r => setTimeout(r, 400));
    item.remove();
    await cambiarEstado(id, 'revisado', { cerrarModal: false, recargarLista: false });
};

window.anularDesdeDashboard = function(id, btn) {
    const item = document.getElementById('dash-item-' + id);
    if (!item) return;
    window._anulacionItemId = id;
    window._anulacionItemEl = item;
    mostrarAnulacion(id);
};

window.revisarConAnimacion = async function(id, btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner mr-2"></span> Revisando...';
    await new Promise(r => setTimeout(r, 500));
    btn.innerHTML = '<i class="mdi mdi-check animate-pop mr-2"></i> Revisado';
    btn.classList.remove('bg-green-600', 'hover:bg-green-700');
    btn.classList.add('bg-green-700');
    await new Promise(r => setTimeout(r, 400));
    await cambiarEstado(id, 'revisado');
};

async function guardarInforme(e) {
    e.preventDefault();
    if (_guardandoInforme) return;
    _guardandoInforme = true;
    const btn = e.submitter;
    if (btn) { btn.disabled = true; btn.classList.add('opacity-50', 'cursor-not-allowed'); }
    try {
        if (getPerfil()?.rol === 'doe') return mostrarToast('No tiene permiso para guardar informes', 'error');
        const alumnoId = document.getElementById('alumnoId').value;
        if (!alumnoId) return mostrarToast('Debe seleccionar un alumno', 'error');
        const editId = document.getElementById('editId').value;
        const titulo = document.getElementById('titulo').value.trim();
        const resumen = document.getElementById('resumen').value.trim();
        const observaciones = document.getElementById('observaciones').value.trim();
        const instancia = document.getElementById('instancia').value;
        const categoriaId = document.getElementById('categoriaInforme').value;

        // Validación de límites
        if (titulo.length > 200) return mostrarToast('El título no puede exceder 200 caracteres', 'error');
        if (resumen.length > 2000) return mostrarToast('La descripción no puede exceder 2000 caracteres', 'error');
        if (observaciones.length > 1000) return mostrarToast('Las observaciones no pueden exceder 1000 caracteres', 'error');
        if (!instancia) return mostrarToast('Debe seleccionar una instancia', 'error');
        if (!categoriaId) return mostrarToast('Debe seleccionar una categoría', 'error');

        const datos = {
            alumno_id: alumnoId,
            categoria_id: categoriaId,
            tipo_falta: 'Otra',
            instancia,
            titulo,
            resumen,
            observaciones: observaciones || null
        };

        if (editId) {
            const inf = getInforme(editId);
            if (!inf) return mostrarToast('Informe no encontrado', 'error');
            if (['archivado', 'anulado'].includes(inf.estado)) return mostrarToast('No se puede editar un informe finalizado', 'error');
            if (inf.creado_por !== getPerfil().id && getPerfil().rol !== 'regente') return mostrarToast('No tiene permiso para editar', 'error');

            mostrarToast('Actualizando informe...', 'info');
            const { error } = await supabaseClient.from('informes').update(datos).eq('id', editId);
            if (error) { return mostrarToast('Error actualizando informe', 'error'); }
            // Informe actualizado
            await registrarHistorial(editId, 'edicion', `Informe editado por ${getNombreUsuario(getPerfil().id)}`);
            await cargarInformes();
            mostrarToast('Informe actualizado correctamente');
        } else {
            const nuevo = {
                id: generarId(),
                ...datos,
                estado: 'pendiente',
                creado_por: getPerfil().id,
                revisado_por: null,
                fecha_creacion: new Date().toISOString(),
                fecha_revision: null,
                motivo_rechazo: null
            };
            mostrarToast('Guardando informe...', 'info');
            const { error } = await supabaseClient.from('informes').insert(nuevo);
            if (error) { return mostrarToast('Error guardando informe', 'error'); }
            // Informe creado
            await registrarHistorial(nuevo.id, 'creacion', `Informe creado por ${getNombreUsuario(getPerfil().id)}`);
            await cargarInformes();
            mostrarToast('Informe creado correctamente');
        }
        cancelarForm();
        showSection('informes');
    } finally {
        _guardandoInforme = false;
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-50', 'cursor-not-allowed'); }
    }
}

function cancelarForm() {
    document.getElementById('formInforme').reset();
    limpiarAlumno();
    document.getElementById('searchAlumno').value = '';
    document.getElementById('resultadosAlumno').classList.add('hidden');
    document.getElementById('plantillaInforme').value = '';
    const otros = categorias.find(c => c.nombre.toLowerCase() === 'otros');
    document.getElementById('categoriaInforme').value = otros ? otros.id : '';
    document.getElementById('observaciones').value = 'Se solicita trabajar con la familia, estudiante y PAT en el respeto por las normas institucionales de convivencia.';

    document.getElementById('editId').value = '';
    document.getElementById('tituloForm').textContent = 'Nuevo Informe';
    document.getElementById('txtBtnGuardar').textContent = 'Guardar Informe';
}

// ==================== HISTORIAL DE INFORMES ====================
async function registrarHistorial(informeId, accion, detalle) {
    if (!USE_SUPABASE) return;
    const perfil = getPerfil();
    const { error } = await supabaseClient.from('historial_informes').insert({
        informe_id: informeId,
        usuario_id: perfil?.id,
        usuario_nombre: perfil ? `${perfil.apellido}, ${perfil.nombre}` : 'Sistema',
        accion,
        detalle
    });

}
window.registrarHistorial = registrarHistorial;

async function cargarHistorial(informeId) {
    if (!USE_SUPABASE) return [];
    const { data, error } = await supabaseClient
        .from('historial_informes')
        .select('*')
        .eq('informe_id', informeId)
        .order('fecha', { ascending: true });
    if (error) return [];
    return data || [];
}
window.cargarHistorial = cargarHistorial;

function renderizarHistorial(historial) {
    if (!historial.length) {
        return '<p class="text-xs text-slate-400 italic">Sin registros de historial.</p>';
    }
    const badgeAccion = {
        creacion: { label: 'CREACIÓN', clase: 'bg-blue-100 text-blue-700 border-blue-200' },
        edicion: { label: 'EDICIÓN', clase: 'bg-amber-100 text-amber-700 border-amber-200' },
        anulado: { label: 'ANULADO', clase: 'bg-red-100 text-red-700 border-red-200' },
        desanulacion: { label: 'DESANULADO', clase: 'bg-blue-100 text-blue-700 border-blue-200' },
        archivado: { label: 'ARCHIVADO', clase: 'bg-slate-100 text-slate-700 border-slate-200' },
        desarchivado: { label: 'DESARCHIVADO', clase: 'bg-blue-100 text-blue-700 border-blue-200' },
        revision: { label: 'REVISIÓN', clase: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
        derivacion: { label: 'DERIVACIÓN', clase: 'bg-green-100 text-green-700 border-green-200' },
        observaciones: { label: 'OBSERVACIÓN', clase: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
        reunion: { label: 'REUNIÓN', clase: 'bg-teal-100 text-teal-700 border-teal-200' },
        reunion_pospuesta: { label: 'REUNIÓN POSPUESTA', clase: 'bg-teal-100 text-teal-700 border-teal-200' },
        reunion_eliminada: { label: 'REUNIÓN ELIMINADA', clase: 'bg-slate-100 text-slate-700 border-slate-200' },
        suspension: { label: 'SUSPENSIÓN', clase: 'bg-red-100 text-red-700 border-red-200' },
        llamado_padres: { label: 'LLAMADO A PADRES', clase: 'bg-orange-100 text-orange-700 border-orange-200' },
        entrevista: { label: 'ENTREVISTA', clase: 'bg-purple-100 text-purple-700 border-purple-200' },
        amonestacion: { label: 'AMONESTACIÓN', clase: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
        notificacion: { label: 'NOTIFICACIÓN', clase: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
        tarea_reparacion: { label: 'TAREA DE REPARACIÓN', clase: 'bg-slate-100 text-slate-700 border-slate-200' },
        otra_accion: { label: 'OTRA ACCIÓN', clase: 'bg-slate-100 text-slate-700 border-slate-200' }
    };
    const verboAccion = {
        creacion: 'creado',
        edicion: 'editado',
        anulado: 'anulado',
        desanulacion: 'desanulado',
        archivado: 'archivado',
        desarchivado: 'desarchivado',
        revision: 'revisado',
        derivacion: 'derivado',
        observaciones: 'observado',
        reunion: 'reunión actualizada',
        reunion_pospuesta: 'reunión pospuesta',
        reunion_eliminada: 'reunión eliminada',
        suspension: 'suspensión aplicada',
        llamado_padres: 'llamado a padres realizado',
        entrevista: 'entrevista registrada',
        amonestacion: 'amonestación aplicada',
        notificacion: 'notificación enviada',
        tarea_reparacion: 'tarea de reparación asignada',
        otra_accion: 'acción registrada'
    };
    return `
    <div class="relative pl-4 border-l-2 border-slate-200 space-y-5">
        ${historial.map((h, idx) => {
            const esUltimo = idx === historial.length - 1;
            const nombre = h.usuario_nombre || getNombreUsuario(h.usuario_id) || 'Usuario eliminado';
            const fecha = formatearFecha(h.fecha);
            const hora = new Date(h.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
            const badge = badgeAccion[h.accion] || { label: (h.accion || 'ACCIÓN').toUpperCase(), clase: 'bg-slate-100 text-slate-700 border-slate-200' };
            const verbo = verboAccion[h.accion] || 'registrado';
            return `
            <div class="relative">
                <div class="absolute -left-[21px] top-1.5 w-3 h-3 rounded-full bg-white border-2 border-blue-400"></div>
                <div class="flex flex-col gap-1">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded border ${badge.clase}">${escapeHtml(badge.label)}</span>
                        <span class="text-xs text-slate-400">${fecha} · ${hora}</span>
                    </div>
                    <p class="text-xs text-slate-500 font-medium">${verbo} por <span class="text-slate-700">${escapeHtml(nombre)}</span></p>
                    ${h.detalle ? `<p class="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">${escapeHtml(h.detalle)}</p>` : ''}
                </div>
            </div>`;
        }).join('')}
    </div>`;
}
window.renderizarHistorial = renderizarHistorial;

// ==================== DETALLE Y ACCIONES ====================
function verDetalle(id) {
    const informe = getInforme(id);
    if (!informe) return;
    const esDestinatario = informe.derivado_a === getPerfil()?.id;
    if (getPerfil()?.rol === 'doe' && !esDestinatario) {
        return mostrarToast('No tiene permiso para ver este informe', 'error');
    }
    const alumno = getAlumno(informe.alumno_id);
    const modal = document.getElementById('modalDetalle');
    const contenido = document.getElementById('contenidoModal');
    const acciones = document.getElementById('accionesModal');
    const esDOE = getPerfil()?.rol === 'doe';
    const esRegente = getPerfil()?.rol === 'regente';
    const puedeEditar = (informe.creado_por === getPerfil().id && informe.estado === 'pendiente' && !esDOE) || (esRegente && informe.estado !== 'archivado' && informe.estado !== 'anulado');

    contenido.innerHTML = `
        <div class="flex items-center gap-3 mb-4 flex-wrap">
            <span class="status-${escapeAttr(informe.estado)} px-3 py-1 rounded-full text-sm font-medium capitalize">${escapeHtml(informe.estado.replace('_', ' '))}</span>
            <span class="text-sm text-slate-500">${formatearFecha(informe.fecha_creacion)}</span>
            ${informe.numero !== null && informe.numero !== undefined ? `<span class="text-lg font-mono font-bold text-slate-800 bg-slate-100 px-3 py-1 rounded border border-slate-200">Informe N° ${escapeHtml(informe.numero)}</span>` : `<span class="text-sm text-red-500 italic">Sin numerar</span>`}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div class="p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors" onclick="verAlumno('${alumno?.id}')">
                <p class="text-xs text-slate-500 mb-1">Alumno</p>
                <p class="font-medium">${alumno ? `${escapeHtml(alumno.apellido)}, ${escapeHtml(alumno.nombre)}` : 'Desconocido'}</p>
                <p class="text-sm text-slate-600">${alumno ? `${escapeHtml(alumno.curso)} ${escapeHtml(alumno.division)}${alumno.turno ? ' · ' + escapeHtml(alumno.turno) : ''}${alumno.especialidad && alumno.especialidad !== 'Sin especialidad' ? ' · ' + escapeHtml(alumno.especialidad) : ''}` : ''}</p>
                <p class="text-xs text-blue-600 mt-1"><i class="mdi mdi-eye-outline mr-1"></i>Ver resumen</p>
            </div>
            <div class="p-3 bg-slate-50 rounded-lg">
                <p class="text-xs text-slate-500 mb-1">Creado por</p>
                <p class="font-medium">${escapeHtml(getNombreUsuario(informe.creado_por))}</p>
            </div>
        </div>
        <div class="space-y-4">
            <div><p class="text-sm font-medium text-slate-700 mb-1">Título</p><p class="text-slate-600">${escapeHtml(informe.titulo)}</p></div>
            <div class="grid grid-cols-2 gap-4">
                <div><p class="text-sm font-medium text-slate-700 mb-1">Instancia</p>
                    <p class="text-slate-600 capitalize font-medium ${informe.instancia === 'muy_grave' ? 'text-red-600' : informe.instancia === 'grave' ? 'text-orange-600' : informe.instancia === 'leve' ? 'text-amber-600' : informe.instancia === 'consejo_aula' ? 'text-pink-600' : informe.instancia === 'consejo' ? 'text-purple-600' : 'text-blue-600'}">${escapeHtml(informe.instancia.replace('_', ' '))}</p>
                </div>
                <div><p class="text-sm font-medium text-slate-700 mb-1">Creado por</p><p class="text-slate-600">${escapeHtml(getNombreUsuario(informe.creado_por))}</p></div>
            </div>
            ${informe.estado === 'derivado' && informe.derivado_a ? `<div class="p-3 bg-green-50 border border-green-200 rounded-lg"><p class="text-sm font-medium text-green-800 mb-1">Derivado a</p><p class="text-green-700">${escapeHtml(getNombreUsuario(informe.derivado_a))}</p></div>` : ''}
            <div><p class="text-sm font-medium text-slate-700 mb-1">Descripción de la problemática</p><p class="text-slate-600 whitespace-pre-wrap">${escapeHtml(informe.resumen)}</p></div>

            ${informe.observaciones ? `<div class="p-3 bg-blue-50 border border-blue-200 rounded-lg"><p class="text-sm font-medium text-blue-800 mb-1">Observaciones previas</p><p class="text-blue-700 whitespace-pre-wrap">${escapeHtml(informe.observaciones)}</p></div>` : ''}
            ${informe.motivo_rechazo ? `<div class="p-3 bg-red-50 border border-red-200 rounded-lg"><p class="text-sm font-medium text-red-800 mb-1">Motivo de la anulación</p><p class="text-red-700">${escapeHtml(informe.motivo_rechazo)}</p></div>` : ''}
            ${informe.fecha_revision ? `<div class="text-sm text-slate-500"><i class="mdi mdi-check-all mr-1"></i>Revisado por ${escapeHtml(getNombreUsuario(informe.revisado_por))} el ${formatearFecha(informe.fecha_revision)}</div>` : ''}
        </div>
        
        <div class="mt-6 border-t border-slate-200 pt-4">
            <h4 class="text-sm font-semibold text-slate-700 mb-3"><i class="mdi mdi-history mr-2 text-blue-500"></i>Historial del informe</h4>
            <div id="historialInforme">Cargando historial...</div>
        </div>
        
        ${(!esDOE || informe.estado === 'derivado') && informe.estado !== 'archivado' && informe.estado !== 'anulado' ? `
        <div class="mt-6 border-t border-slate-200 pt-4 space-y-4">
            <h4 class="text-sm font-semibold text-slate-700"><i class="mdi mdi-plus-circle-outline mr-2 text-green-500"></i>Agregar seguimiento</h4>
            
            <div class="p-3 bg-slate-50 rounded-lg space-y-2">
                <label class="text-xs font-medium text-slate-600">Nueva observación</label>
                <textarea id="nuevaObservacionTexto" rows="2" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none text-sm" placeholder="Escriba una observación..."></textarea>
                <button onclick="agregarObservacion('${informe.id}')" class="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors">Agregar observación</button>
            </div>
            
            <div class="p-3 bg-slate-50 rounded-lg space-y-2">
                <label class="text-xs font-medium text-slate-600">Acción tomada</label>
                <input type="text" id="nuevaAccionTipo" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="Ej: Suspensión, Llamado a padres, Entrevista...">
                <textarea id="nuevaAccionDetalle" rows="2" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none text-sm" placeholder="Detalle de la acción..."></textarea>
                <button onclick="agregarAccion('${informe.id}')" class="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors">Agregar acción</button>
            </div>
        </div>
        ` : ''}
    `;

    cargarHistorial(informe.id).then(historial => {
        const container = document.getElementById('historialInforme');
        if (container) container.innerHTML = renderizarHistorial(historial);
    });

    acciones.innerHTML = '';
    if (puedeEditar) {
        acciones.innerHTML += `<button onclick="editarInforme('${informe.id}')" class="flex-1 min-w-[120px] bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors"><i class="mdi mdi-pencil-outline mr-2"></i>Editar</button>`;
    }
    if (esRegente) {
        if (informe.estado === 'pendiente') {
            acciones.innerHTML += `
                <button id="btn-modal-revisar-${informe.id}" onclick="revisarConAnimacion('${informe.id}', this)" class="flex-1 min-w-[120px] bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors"><i class="mdi mdi-eye-outline mr-2"></i>Revisado</button>
                <button onclick="mostrarAnulacion('${informe.id}')" class="flex-1 min-w-[120px] bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg transition-colors"><i class="mdi mdi-cancel mr-2"></i>Anular</button>`;
        }
        if (informe.estado === 'revisado') {
            acciones.innerHTML += `
                <button onclick="cambiarEstado('${informe.id}', 'archivado')" class="flex-1 min-w-[120px] bg-slate-600 hover:bg-slate-700 text-white py-2 rounded-lg transition-colors"><i class="mdi mdi-archive-outline mr-2"></i>Archivar</button>
                <button onclick="mostrarDerivacion('${informe.id}')" class="flex-1 min-w-[120px] bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg transition-colors"><i class="mdi mdi-share-variant-outline mr-2"></i>Derivar</button>`;
        }
        if (informe.estado === 'archivado') {
            acciones.innerHTML += `<button onclick="cambiarEstado('${informe.id}', 'revisado')" class="flex-1 min-w-[120px] bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors"><i class="mdi mdi-undo-variant mr-2"></i>Guardar en revisados</button>`;
        }
        if (informe.estado === 'anulado') {
            acciones.innerHTML += `<button onclick="cambiarEstado('${informe.id}', 'revisado')" class="flex-1 min-w-[120px] bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors"><i class="mdi mdi-undo-variant mr-2"></i>Guardar en revisados</button>`;
        }
    }
    if ((esRegente || esDestinatario) && informe.estado === 'derivado') {
        acciones.innerHTML += `<button onclick="cambiarEstado('${informe.id}', 'pendiente')" class="flex-1 min-w-[120px] bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors"><i class="mdi mdi-undo-variant mr-2"></i>Volver a pendiente</button>`;
    }
    acciones.innerHTML += `<button onclick="exportarPDF('${informe.id}')" class="min-w-[120px] bg-slate-600 hover:bg-slate-700 text-white py-2 rounded-lg transition-colors"><i class="mdi mdi-file-pdf-box mr-2"></i><span class="sm:hidden">Imprimir</span><span class="hidden sm:inline">PDF</span></button>`;
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

let _guardandoObservacion = false;
async function agregarObservacion(informeId) {
    if (_guardandoObservacion) return;
    const textarea = document.getElementById('nuevaObservacionTexto');
    const texto = textarea?.value.trim();
    if (!texto) return mostrarToast('Ingrese una observación', 'error');
    _guardandoObservacion = true;
    try {
        await registrarHistorial(informeId, 'observaciones', texto);
        const historial = await cargarHistorial(informeId);
        const container = document.getElementById('historialInforme');
        if (container) container.innerHTML = renderizarHistorial(historial);
        textarea.value = '';
        mostrarToast('Observación agregada');
    } finally {
        _guardandoObservacion = false;
    }
}
window.agregarObservacion = agregarObservacion;

let _guardandoAccion = false;
async function agregarAccion(informeId) {
    if (_guardandoAccion) return;
    const tipoInput = document.getElementById('nuevaAccionTipo');
    const detalleText = document.getElementById('nuevaAccionDetalle');
    const tipo = tipoInput?.value.trim();
    const detalle = detalleText?.value.trim();
    if (!tipo) return mostrarToast('Ingrese el tipo de acción', 'error');
    if (!detalle) return mostrarToast('Ingrese el detalle de la acción', 'error');
    _guardandoAccion = true;
    try {
        await registrarHistorial(informeId, tipo, detalle);
        const historial = await cargarHistorial(informeId);
        const container = document.getElementById('historialInforme');
        if (container) container.innerHTML = renderizarHistorial(historial);
        tipoInput.value = '';
        detalleText.value = '';
        mostrarToast('Acción registrada');
    } finally {
        _guardandoAccion = false;
    }
}
window.agregarAccion = agregarAccion;

function cerrarModal() { document.getElementById('modalDetalle').classList.add('hidden'); document.body.classList.remove('overflow-hidden'); }

function cerrarModalGrupo() { document.getElementById('modalGrupoInformes').classList.add('hidden'); document.body.classList.remove('overflow-hidden'); }

function abrirModalGrupoInformes(informesGrupo, timestampDia, mostrarAlumno = false) {
    const modal = document.getElementById('modalGrupoInformes');
    const titulo = document.getElementById('tituloModalGrupo');
    const contenido = document.getElementById('contenidoModalGrupo');
    const instancia = informesGrupo[0].instancia;
    const labelInstancia = { leve: 'Leve', grave: 'Grave', muy_grave: 'Muy Grave', consejo_aula: 'Consejo de Aula', consejo: 'Consejo Escolar de Convivencia' };
    const colorInstancia = { leve: 'text-amber-600', grave: 'text-orange-600', muy_grave: 'text-red-600', consejo_aula: 'text-pink-600', consejo: 'text-purple-600' };

    const fechaHtml = timestampDia ? `<span class="text-sm text-slate-500 font-normal block">${formatearFechaCorta(new Date(timestampDia))}</span>` : '';
    titulo.innerHTML = `${fechaHtml}${informesGrupo.length} informes ${labelInstancia[instancia] ?? instancia}`;

    contenido.innerHTML = informesGrupo.map(i => {
        const alumno = mostrarAlumno ? getAlumno(i.alumno_id) : null;
        return `
        <div data-informe-id="${i.id}" class="cursor-pointer bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg p-4 transition-colors">
            <div class="flex items-center justify-between gap-2 mb-1 flex-wrap">
                <div class="flex items-center gap-2">
                    <span class="status-${escapeAttr(i.estado)} px-2 py-0.5 rounded-full text-xs font-medium capitalize">${escapeHtml(i.estado.replace('_', ' '))}</span>
                    ${i.numero !== null && i.numero !== undefined ? `<span class="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-1 py-0.5 rounded">Informe N° ${escapeHtml(i.numero)}</span>` : `<span class="text-xs text-red-500 italic">Sin numerar</span>`}
                </div>
                <span class="text-xs ${colorInstancia[i.instancia] ?? 'text-blue-600'} font-semibold capitalize">${escapeHtml(labelInstancia[i.instancia] ?? i.instancia)}</span>
            </div>
            <p class="font-medium text-slate-800 text-sm">${i.numero !== null && i.numero !== undefined ? `<span class="font-mono text-slate-500 mr-1">Informe N° ${escapeHtml(i.numero)}</span>` : `<span class="text-xs text-red-500 italic mr-1">Sin numerar</span>`}${escapeHtml(i.titulo)}</p>
            ${alumno ? `<p class="text-xs text-slate-500 mt-0.5">${escapeHtml(alumno.apellido)}, ${escapeHtml(alumno.nombre)} • ${escapeHtml(alumno.curso)} ${escapeHtml(alumno.division)}${alumno.turno ? ' · ' + escapeHtml(alumno.turno) : ''}${alumno.especialidad && alumno.especialidad !== 'Sin especialidad' ? ' · ' + escapeHtml(alumno.especialidad) : ''}</p>` : ''}
            <p class="text-xs text-slate-500 mt-1 line-clamp-2">${escapeHtml(i.resumen)}</p>
        </div>
    `}).join('');

    contenido.querySelectorAll('[data-informe-id]').forEach(el => {
        el.addEventListener('click', () => {
            cerrarModalGrupo();
            verDetalle(el.dataset.informeId);
        });
    });

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

async function cambiarEstado(id, nuevoEstado, options = {}) {
    const { silent = false, cerrarModal: debeCerrarModal = true, recargarLista = true, fecha_reunion } = options;
    if (!silent) mostrarToast('Procesando...', 'info');
    const esDOE = getPerfil()?.rol === 'doe';
    const esRegente = getPerfil()?.rol === 'regente';
    const perfil = getPerfil();
    const informe = getInforme(id);
    
    const esDestinatario = informe?.derivado_a === perfil?.id;
    // Destinatario solo puede devolver de derivado a pendiente
    if (!esRegente && esDestinatario && !(informe?.estado === 'derivado' && nuevoEstado === 'pendiente')) {
        return mostrarToast('No tiene permiso para cambiar este estado', 'error');
    }
    // Solo regente puede cambiar otros estados
    if (!esRegente && !esDestinatario) return mostrarToast('No tiene permiso para cambiar estados', 'error');
    
    const updates = {
        estado: nuevoEstado,
        revisado_por: perfil?.id,
        fecha_revision: new Date().toISOString()
    };
    if (nuevoEstado !== 'anulado') updates.motivo_rechazo = null;
    if (nuevoEstado !== 'derivado') updates.derivado_a = null;
    if (fecha_reunion !== undefined) updates.fecha_reunion = fecha_reunion;

    let error = null;
    if (!esRegente && informe?.estado === 'derivado' && nuevoEstado === 'pendiente') {
        const { error: rpcError } = await supabaseClient.rpc('devolver_informe_a_pendiente', { p_informe_id: id });
        error = rpcError;
    } else {
        const { error: updError } = await supabaseClient.from('informes').update(updates).eq('id', id);
        error = updError;
    }
    
    if (error) {
        return mostrarToast('Error al actualizar el estado del informe', 'error');
    }
    
    const labelMap = {
        pendiente: 'devuelto a pendiente',
        revisado: 'revisado',
        anulado: 'anulado',
        archivado: 'archivado',
        derivado: 'derivado al DOE'
    };
    const accionMap = {
        pendiente: 'revision',
        revisado: 'revision',
        anulado: 'anulado',
        archivado: 'archivado',
        derivado: 'derivacion'
    };

    // Detectar desanulación / desarchivado para historial diferenciado
    let accionHistorial = accionMap[nuevoEstado] || 'revision';
    let detalleHistorial = `Informe ${labelMap[nuevoEstado] || nuevoEstado} por ${getNombreUsuario(getPerfil().id)}`;
    let toastLabel = labelMap[nuevoEstado] || nuevoEstado;
    if (informe?.estado === 'anulado' && nuevoEstado === 'revisado') {
        accionHistorial = 'desanulacion';
        detalleHistorial = `Informe desanulado por ${getNombreUsuario(getPerfil().id)}`;
        toastLabel = 'desanulado';
    } else if (informe?.estado === 'archivado' && nuevoEstado === 'revisado') {
        accionHistorial = 'desarchivado';
        detalleHistorial = `Informe desarchivado por ${getNombreUsuario(getPerfil().id)}`;
        toastLabel = 'desarchivado';
    }

    await registrarHistorial(id, accionHistorial, detalleHistorial);
    await cargarInformes();
    if (!silent) mostrarToast(`Informe ${toastLabel} correctamente`);
    if (debeCerrarModal) cerrarModal();
    if (recargarLista) filtrarInformes();
    actualizarDashboard();
}

function mostrarAnulacion(id) {
    anulacionId = id;
    document.getElementById('modalAnulacion').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    document.getElementById('motivoAnulacion').value = '';
    const modalContent = document.getElementById('modalAnulacion').querySelector('.bg-white');
    if (modalContent) {
        modalContent.classList.remove('animate-fade-in');
        void modalContent.offsetWidth; // trigger reflow
        modalContent.classList.add('animate-fade-in');
    }
}
function cerrarModalAnulacion() {
    document.getElementById('modalAnulacion').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    anulacionId = null;
    window._rechazoItemId = null;
    window._rechazoItemEl = null;
}
async function confirmarAnulacion() {
    if (getPerfil()?.rol === 'doe') return mostrarToast('No tiene permiso para anular informes', 'error');
    const motivo = document.getElementById('motivoAnulacion').value.trim();
    const btnConfirmar = document.getElementById('btn-confirmar-anulacion');
    if (!motivo) {
        const textarea = document.getElementById('motivoAnulacion');
        textarea.classList.add('animate-shake');
        setTimeout(() => textarea.classList.remove('animate-shake'), 400);
        return mostrarToast('Debe indicar un motivo', 'error');
    }

    function restaurarBoton() {
        if (btnConfirmar) {
            btnConfirmar.innerHTML = btnConfirmar.dataset.originalText || 'Rechazar';
            btnConfirmar.disabled = false;
        }
    }

    // Animación del botón
    if (btnConfirmar) {
        btnConfirmar.dataset.originalText = btnConfirmar.innerHTML;
        btnConfirmar.innerHTML = '<span class="btn-spinner mr-2"></span> Rechazando...';
        btnConfirmar.disabled = true;
    }

    try {
        // Si venía desde la lista, animar slide-out del item y remover del DOM
        const vinoDesdeLista = !!window._rechazoItemEl;
        if (window._rechazoItemEl) {
            window._rechazoItemEl.classList.add('animate-slide-out');
            await new Promise(r => setTimeout(r, 400));
            window._rechazoItemEl.remove();
        }

        const updates = {
            estado: 'anulado',
            motivo_rechazo: motivo,
            revisado_por: getPerfil().id,
            fecha_revision: new Date().toISOString()
        };
        mostrarToast('Anulando informe...', 'info');
        const { error } = await supabaseClient.from('informes').update(updates).eq('id', anulacionId);
        if (error) { throw new Error('Error rechazando informe'); }
        // Informe rechazado
        await registrarHistorial(anulacionId, 'anulado', `Informe anulado por ${getNombreUsuario(getPerfil().id)}. Motivo: ${motivo}`);
        await cargarInformes();

        mostrarToast('Informe anulado');
        cerrarModalAnulacion();
        if (!vinoDesdeLista) filtrarInformes();
        actualizarDashboard();
    } catch (err) {
        mostrarToast(err.message || 'Error anulando informe', 'error');
    } finally {
        restaurarBoton();
    }
}

function mostrarDerivacion(id) {
    derivacionId = id;
    document.getElementById('modalDerivacion').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    document.getElementById('motivoDerivacion').value = '';
    const select = document.getElementById('selectDerivacionDestinatario');
    const perfilActual = getPerfil();
    const activos = usuarios.filter(u => u.activo !== false && u.id !== perfilActual?.id).sort((a, b) => `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`));
    select.innerHTML = '<option value="">Seleccione un usuario...</option>' + activos.map(u => `<option value="${escapeAttr(u.id)}">${escapeHtml(u.apellido)}, ${escapeHtml(u.nombre)} (${escapeHtml(u.rol)})</option>`).join('');
    const modalContent = document.getElementById('modalDerivacion').querySelector('.bg-white');
    if (modalContent) {
        modalContent.classList.remove('animate-fade-in');
        void modalContent.offsetWidth;
        modalContent.classList.add('animate-fade-in');
    }
}
function cerrarModalDerivacion() {
    document.getElementById('modalDerivacion').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    derivacionId = null;
}
async function confirmarDerivacion() {
    const destinatarioId = document.getElementById('selectDerivacionDestinatario').value;
    const observaciones = document.getElementById('motivoDerivacion').value.trim();
    if (!destinatarioId) {
        const select = document.getElementById('selectDerivacionDestinatario');
        select.classList.add('animate-shake');
        setTimeout(() => select.classList.remove('animate-shake'), 400);
        return mostrarToast('Debe seleccionar un destinatario', 'error');
    }
    const btnConfirmar = document.getElementById('btn-confirmar-derivacion');
    if (btnConfirmar) {
        btnConfirmar.dataset.originalText = btnConfirmar.innerHTML;
        btnConfirmar.innerHTML = '<span class="btn-spinner mr-2"></span> Derivando...';
        btnConfirmar.disabled = true;
    }
    mostrarToast('Derivando informe...', 'info');
    const { error } = await supabaseClient.from('informes').update({
        estado: 'derivado',
        derivado_a: destinatarioId,
        revisado_por: getPerfil().id,
        fecha_revision: new Date().toISOString()
    }).eq('id', derivacionId);
    if (error) {
        if (btnConfirmar) {
            btnConfirmar.innerHTML = btnConfirmar.dataset.originalText || 'Derivar';
            btnConfirmar.disabled = false;
        }
        return mostrarToast('Error derivando informe', 'error');
    }
    const destinatario = usuarios.find(u => u.id === destinatarioId);
    const destLabel = destinatario ? `${destinatario.apellido}, ${destinatario.nombre}` : destinatarioId;
    await registrarHistorial(derivacionId, 'derivacion', `Informe derivado a ${destLabel} por ${getNombreUsuario(getPerfil().id)}${observaciones ? '. ' + observaciones : ''}`);
    await cargarInformes();
    mostrarToast('Informe derivado correctamente');
    cerrarModalDerivacion();
    cerrarModal();
    filtrarInformes();
    actualizarDashboard();
    if (btnConfirmar) {
        btnConfirmar.innerHTML = btnConfirmar.dataset.originalText || 'Derivar';
        btnConfirmar.disabled = false;
    }
}

function editarInforme(id) {
    const informe = getInforme(id);
    if (!informe) return;
    const esRegente = getPerfil()?.rol === 'regente';
    if (!esRegente && informe.creado_por !== getPerfil()?.id) return mostrarToast('No tiene permiso para editar este informe', 'error');
    if (['archivado', 'anulado'].includes(informe.estado)) return mostrarToast('No se puede editar un informe finalizado', 'error');
    const alumno = getAlumno(informe.alumno_id);
    document.getElementById('editId').value = informe.id;
    document.getElementById('alumnoId').value = informe.alumno_id;
    document.getElementById('alumnoNombre').textContent = alumno ? `${alumno.apellido}, ${alumno.nombre}` : '';
    document.getElementById('alumnoCurso').textContent = alumno ? `${alumno.curso} ${alumno.division}${alumno.turno ? ' · ' + alumno.turno : ''}${alumno.especialidad && alumno.especialidad !== 'Sin especialidad' ? ' · ' + alumno.especialidad : ''}` : '';
    document.getElementById('alumnoSeleccionado').classList.remove('hidden');
    document.getElementById('categoriaInforme').value = informe.categoria_id || '';
    document.getElementById('instancia').value = informe.instancia;
    document.getElementById('titulo').value = informe.titulo;
    document.getElementById('resumen').value = informe.resumen;

    document.getElementById('observaciones').value = informe.observaciones || '';
    document.getElementById('tituloForm').textContent = 'Editar Informe';
    document.getElementById('txtBtnGuardar').textContent = 'Actualizar Informe';
    cerrarModal();
    showSection('nuevo');
}

// ==================== DASHBOARD ====================
function renderCalendarioReuniones() {
    const grid = document.getElementById('calGrid');
    const label = document.getElementById('calMesAnio');
    if (!grid || !label) return;

    const year = calCurrentDate.getFullYear();
    const month = calCurrentDate.getMonth();
    label.textContent = calCurrentDate.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

    const firstDay = new Date(year, month, 1).getDay(); // 0=Dom
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Reuniones del mes (con fecha_reunion asignada)
    const reunionesMes = informes.filter(i => {
        if (!i.fecha_reunion) return false;
        const d = parseFechaLocal(i.fecha_reunion);
        return d && d.getFullYear() === year && d.getMonth() === month;
    });

    const reunionesPorDia = {};
    reunionesMes.forEach(i => {
        const d = parseFechaLocal(i.fecha_reunion)?.getDate();
        if (!reunionesPorDia[d]) reunionesPorDia[d] = [];
        reunionesPorDia[d].push(i);
    });

    let html = '';
    // Celdas vacías antes del primer día
    for (let i = 0; i < firstDay; i++) {
        html += '<div></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const tiene = reunionesPorDia[d];
        const isSelected = calSelectedDate && calSelectedDate.getDate() === d && calSelectedDate.getMonth() === month && calSelectedDate.getFullYear() === year;
        const baseCls = 'h-8 flex flex-col items-center justify-center rounded-lg text-sm cursor-pointer transition-colors relative ';
        const dayCls = isSelected
            ? baseCls + 'bg-blue-600 text-white font-semibold'
            : tiene
                ? baseCls + 'bg-amber-50 text-slate-700 hover:bg-amber-100 font-medium'
                : baseCls + 'text-slate-600 hover:bg-slate-100';
        const dot = tiene
            ? `<span class="absolute bottom-1 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-amber-500'}"></span>`
            : '';
        html += `<div class="${dayCls}" onclick="seleccionarDiaCal(${d})">${d}${dot}</div>`;
    }
    grid.innerHTML = html;

    // Mostrar/ocultar botón "Ver todos"
    const btnVerTodos = document.getElementById('calVerTodos');
    if (btnVerTodos) {
        btnVerTodos.classList.toggle('hidden', !calSelectedDate);
    }
}

window.seleccionarDiaCal = function(dia) {
    const year = calCurrentDate.getFullYear();
    const month = calCurrentDate.getMonth();
    // Si ya está seleccionado, deseleccionar
    if (calSelectedDate && calSelectedDate.getDate() === dia && calSelectedDate.getMonth() === month && calSelectedDate.getFullYear() === year) {
        calSelectedDate = null;
    } else {
        calSelectedDate = new Date(year, month, dia);
    }
    renderCalendarioReuniones();
    renderReunionesDiaSeleccionado();
};

function renderReunionesDiaSeleccionado() {
    const container = document.getElementById('dashReuniones');
    if (!container) return;

    const year = calCurrentDate.getFullYear();
    const month = calCurrentDate.getMonth();
    const dia = calSelectedDate ? calSelectedDate.getDate() : null;

    const reuniones = informes.filter(i => {
        if (!i.fecha_reunion) return false;
        const d = parseFechaLocal(i.fecha_reunion);
        if (!d) return false;
        if (dia !== null) return d.getFullYear() === year && d.getMonth() === month && d.getDate() === dia;
        return d.getFullYear() === year && d.getMonth() === month;
    }).sort((a, b) => parseFechaLocal(a.fecha_reunion) - parseFechaLocal(b.fecha_reunion));

    if (reuniones.length === 0) {
        const msg = dia !== null
            ? `Sin reuniones el ${dia}/${month + 1}.`
            : 'Sin reuniones este mes.';
        container.innerHTML = `<p class="text-sm text-slate-400 italic">${msg}</p>`;
        return;
    }

    const hoy = new Date();
    hoy.setHours(0,0,0,0);

    container.innerHTML = reuniones.map(i => {
        const alumno = getAlumno(i.alumno_id);
        const fechaReunion = parseFechaLocal(i.fecha_reunion);
        const esPasada = fechaReunion < hoy;
        const estadoClase = esPasada ? 'bg-slate-400' : 'bg-blue-500';
        return `
        <div class="flex items-start gap-2 p-2 hover:bg-slate-50 rounded-lg transition-colors">
            <div class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${estadoClase}">${alumno ? alumno.nombre[0] + alumno.apellido[0] : '?'}</div>
            <div class="flex-1 min-w-0 cursor-pointer" onclick="verDetalle('${i.id}')">
                <p class="text-sm font-medium text-slate-800 truncate">${i.numero !== null && i.numero !== undefined ? `<span class="font-mono text-slate-500 mr-1">Informe N° ${i.numero}</span>` : `<span class="text-xs text-red-500 italic mr-1">Sin numerar</span>`}${i.titulo}</p>
                <p class="text-xs text-slate-500">${alumno ? `${alumno.apellido}, ${alumno.nombre}` : 'Desconocido'} • ${formatearFechaCorta(i.fecha_reunion)}</p>
            </div>
            <div class="flex gap-1">
                <button onclick="event.stopPropagation(); mostrarModalGestionReunion('${i.id}', '${i.fecha_reunion}')" class="text-xs text-blue-600 hover:text-blue-800 p-1" title="Gestionar"><i class="mdi mdi-pencil-outline"></i></button>
            </div>
        </div>`;
    }).join('');
}

function actualizarDashboard() {
    const estados = { pendiente: 0, revisado: 0, derivado: 0, archivado: 0, anulado: 0 };
    const instancias = { leve: 0, grave: 0, muy_grave: 0, consejo_aula: 0, consejo: 0 };
    informes.forEach(i => {
        if (estados[i.estado] !== undefined) estados[i.estado]++;
        if (instancias[i.instancia] !== undefined) instancias[i.instancia]++;
    });
    document.getElementById('dashPendientes').textContent = estados.pendiente;
    document.getElementById('dashAprobados').textContent = estados.revisado;
    document.getElementById('dashRechazados').textContent = estados.derivado;
    document.getElementById('dashTotal').textContent = informes.length;

    // ── 1. Calendario + Reuniones ──
    // Por defecto mostramos TODOS los pendientes del mes (sin día seleccionado)
    renderCalendarioReuniones();
    renderReunionesDiaSeleccionado();

    // ── 2. Pendientes de revisión (con acciones rápidas) ──
    const pendientesLista = informes
        .filter(i => i.estado === 'pendiente')
        .sort((a, b) => new Date(a.fecha_creacion) - new Date(b.fecha_creacion));
    const pendientesHTML = pendientesLista.length === 0
        ? '<p class="text-sm text-slate-400 italic">No hay informes pendientes.</p>'
        : pendientesLista.map(i => {
            const alumno = getAlumno(i.alumno_id);
            return `
            <div id="dash-item-${i.id}" class="flex flex-col sm:flex-row sm:items-center gap-2 p-3 bg-slate-50 rounded-lg border border-slate-100 card-scroll cursor-pointer" onclick="if(event.target.closest('button')) return; verDetalle('${i.id}')">
                <div class="flex items-center gap-3 flex-1 min-w-0">
                    <div class="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-xs font-bold text-white shrink-0">${alumno ? alumno.nombre[0] + alumno.apellido[0] : '?'}</div>
                    <div class="min-w-0">
                        <p class="text-sm font-medium text-slate-800 truncate">${i.titulo}</p>
                        <p class="text-xs text-slate-500">${alumno ? `${alumno.apellido}, ${alumno.nombre}` : 'Desconocido'} • ${formatearFechaCorta(i.fecha_creacion)}${i.numero !== null && i.numero !== undefined ? ` • <span class="font-mono font-bold">Informe N° ${i.numero}</span>` : ` • <span class="text-xs text-red-500 italic">Sin numerar</span>`}</p>
                    </div>
                </div>
                <div class="flex gap-2 shrink-0">
                    <button onclick="event.stopPropagation(); verDetalle('${i.id}')" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors"><i class="mdi mdi-eye-outline mr-1"></i>Revisar</button>
                    <button onclick="event.stopPropagation(); anularDesdeDashboard('${i.id}', this)" class="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg transition-colors"><i class="mdi mdi-cancel mr-1"></i>Anular</button>
                </div>
            </div>`;
        }).join('');
    document.getElementById('dashPendientesLista').innerHTML = pendientesHTML;
    document.getElementById('dashPendientesLista')?.querySelectorAll('.card-scroll').forEach(card => cardObserver.observe(card));

    // ── 3. Historial reciente (todos excepto pendientes) ──
    const historial = informes
        .filter(i => i.estado !== 'pendiente')
        .sort((a, b) => new Date(b.fecha_revision || b.fecha_creacion) - new Date(a.fecha_revision || a.fecha_creacion))
        .slice(0, 12);
    const colorEstado = { revisado: 'bg-blue-500', derivado: 'bg-green-500', archivado: 'bg-slate-500', anulado: 'bg-red-500' };
    const historialHTML = historial.length === 0
        ? '<p class="text-sm text-slate-400 italic">Sin historial.</p>'
        : historial.map(i => {
            const alumno = getAlumno(i.alumno_id);
            return `
            <div class="flex items-start gap-3 p-3 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer card-scroll" onclick="verDetalle('${i.id}')">
                <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${colorEstado[i.estado] || 'bg-slate-500'}">${alumno ? alumno.nombre[0] + alumno.apellido[0] : '?'}</div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-slate-800 truncate">${i.titulo}</p>
                    <p class="text-xs text-slate-500">${alumno ? `${alumno.apellido}, ${alumno.nombre}` : 'Desconocido'} • ${formatearFechaCorta(i.fecha_revision || i.fecha_creacion)}${i.numero !== null && i.numero !== undefined ? ` • <span class="font-mono font-bold">Informe N° ${i.numero}</span>` : ` • <span class="text-xs text-red-500 italic">Sin numerar</span>`}</p>
                </div>
                <span class="status-${i.estado} px-2 py-0.5 rounded text-xs capitalize">${i.estado.replace('_', ' ')}</span>
            </div>`;
        }).join('');
    document.getElementById('dashHistorial').innerHTML = historialHTML;
    document.getElementById('dashHistorial')?.querySelectorAll('.card-scroll').forEach(card => cardObserver.observe(card));

    // ── 4. Gráfico de gravedad (bugfix: aspectRatio fijo + contenedor h-64) ──
    const ctx = document.getElementById('dashChart').getContext('2d');
    if (charts.dash) charts.dash.destroy();
    const dashLabels = ['Leve', 'Grave', 'Muy Grave', 'Consejo de Aula', 'Consejo Escolar'];
    const dashInstanciaPorLabel = { 'Leve': 'leve', 'Grave': 'grave', 'Muy Grave': 'muy_grave', 'Consejo de Aula': 'consejo_aula', 'Consejo Escolar': 'consejo' };
    charts.dash = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: dashLabels,
            datasets: [{
                data: [instancias.leve, instancias.grave, instancias.muy_grave, instancias.consejo_aula, instancias.consejo],
                backgroundColor: ['#fbbf24', '#f97316', '#ef4444', '#db2777', '#7c3aed'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            maintainAspectRatio: false,
            aspectRatio: 1,
            onClick: (e, elements) => {
                if (!elements.length) return;
                const label = dashLabels[elements[0].index];
                const instancia = dashInstanciaPorLabel[label];
                if (!instancia) return;
                const filtrados = informes.filter(i => i.instancia === instancia);
                if (filtrados.length) abrirModalGrupoInformes(filtrados, null, true);
            },
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16 } }
            }
        }
    });
}

// ==================== ESTADÍSTICAS ====================
let _drillDownPorCurso = {};

function cargarEstadisticas() {
    // Gráfico por CURSO (año/grado) con drill-down por división
    const porCurso = {};
    _drillDownPorCurso = {};
    informes.forEach(i => {
        const alumno = getAlumno(i.alumno_id);
        if (!alumno) return;
        porCurso[alumno.curso] = (porCurso[alumno.curso] || 0) + 1;
        const divKey = `${alumno.curso} ${alumno.division}`;
        if (!_drillDownPorCurso[alumno.curso]) _drillDownPorCurso[alumno.curso] = {};
        _drillDownPorCurso[alumno.curso][divKey] = (_drillDownPorCurso[alumno.curso][divKey] || 0) + 1;
    });
    const cursos = Object.keys(porCurso).sort((a, b) => {
        // Ordenar numéricamente: 1°, 2°, 3°... quitando el ° para comparar
        const na = parseInt(a.replace('°', ''));
        const nb = parseInt(b.replace('°', ''));
        return na - nb;
    });
    const ctxCursos = document.getElementById('chartCursos').getContext('2d');
    if (charts.cursos) charts.cursos.destroy();
    charts.cursos = new Chart(ctxCursos, {
        type: 'bar',
        data: { labels: cursos, datasets: [{ label: 'Informes', data: cursos.map(c => porCurso[c]), backgroundColor: '#3b82f6', borderRadius: 6 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const curso = cursos[idx];
                    mostrarDrillDownAnio(curso, _drillDownPorCurso[curso]);
                }
            }
        }
    });

    const porCategoria = {};
    informes.forEach(i => {
        const cat = categorias.find(c => c.id === i.categoria_id);
        const nombre = cat ? cat.nombre : 'Sin categoría';
        porCategoria[nombre] = (porCategoria[nombre] || 0) + 1;
    });
    const catOrdenadas = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
    const tiposLabels = catOrdenadas.map(e => e[0]);
    const tiposData = catOrdenadas.map(e => e[1]);
    const catColors = catOrdenadas.map(e => {
        const cat = categorias.find(c => c.nombre === e[0]);
        return cat ? cat.color : '#94a3b8';
    });
    const ctxTipos = document.getElementById('chartTipos').getContext('2d');
    if (charts.tipos) charts.tipos.destroy();
    charts.tipos = new Chart(ctxTipos, {
        type: 'pie',
        data: { labels: tiposLabels, datasets: [{ data: tiposData, backgroundColor: catColors }] },
        options: {
            responsive: false,
            animation: { duration: 1200, easing: 'easeOutQuart' },
            onClick: (e, elements) => {
                if (!elements.length) return;
                const label = tiposLabels[elements[0].index];
                const cat = categorias.find(c => c.nombre === label);
                const filtrados = cat ? informes.filter(i => i.categoria_id === cat.id) : informes.filter(i => !i.categoria_id);
                if (filtrados.length) abrirModalGrupoInformes(filtrados, null, true);
            },
            plugins: { legend: { position: 'bottom' } }
        }
    });

    // Tendencia según período seleccionado (agrupado inteligentemente)
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    let grupos = [];
    let unidadLabel = '';

    if (periodoTendenciaDias <= 30) {
        // Por día
        unidadLabel = 'día';
        for (let i = periodoTendenciaDias - 1; i >= 0; i--) {
            const d = new Date(hoy);
            d.setDate(d.getDate() - i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const label = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
            grupos.push({ label, key, ini: new Date(d), fin: new Date(d), conteo: 0 });
        }
    } else if (periodoTendenciaDias <= 90) {
        // Por semana
        unidadLabel = 'semana';
        const totalSemanas = Math.ceil(periodoTendenciaDias / 7);
        for (let i = totalSemanas - 1; i >= 0; i--) {
            const fin = new Date(hoy);
            fin.setDate(fin.getDate() - i * 7);
            const ini = new Date(fin);
            ini.setDate(ini.getDate() - 6);
            const key = `${ini.toISOString().split('T')[0]}_${fin.toISOString().split('T')[0]}`;
            const label = `${String(ini.getDate()).padStart(2, '0')}/${String(ini.getMonth() + 1).padStart(2, '0')} - ${String(fin.getDate()).padStart(2, '0')}/${String(fin.getMonth() + 1).padStart(2, '0')}`;
            grupos.push({ label, key, ini, fin, conteo: 0 });
        }
    } else {
        // Por mes
        unidadLabel = 'mes';
        const mesesAtras = Math.ceil(periodoTendenciaDias / 30);
        for (let i = mesesAtras - 1; i >= 0; i--) {
            const d = new Date(hoy);
            d.setMonth(d.getMonth() - i);
            const ini = new Date(d.getFullYear(), d.getMonth(), 1);
            const fin = new Date(d.getFullYear(), d.getMonth() + 1, 0);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = `${d.toLocaleString('es-AR', { month: 'short' })} ${d.getFullYear()}`;
            grupos.push({ label, key, ini, fin, conteo: 0 });
        }
    }

    // Contar informes en cada grupo
    informes.forEach(i => {
        const fecha = new Date(i.fecha_creacion);
        fecha.setHours(0, 0, 0, 0);
        const grupo = grupos.find(g => fecha >= g.ini && fecha <= g.fin);
        if (grupo) grupo.conteo++;
    });

    const ctxMensual = document.getElementById('chartMensual').getContext('2d');
    if (charts.mensual) charts.mensual.destroy();
    charts.mensual = new Chart(ctxMensual, {
        type: 'line',
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            animation: {
                x: {
                    type: 'number',
                    easing: 'linear',
                    duration: 800,
                    from: NaN,
                    delay(ctx) {
                        if (ctx.type !== 'data' || ctx.xStarted) {
                            return 0;
                        }
                        ctx.xStarted = true;
                        return ctx.index * (800 / ctx.chart.data.labels.length);
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor: '#f8fafc',
                    bodyColor: '#f8fafc',
                    cornerRadius: 8,
                    padding: 10,
                    displayColors: false,
                    callbacks: {
                        title: (items) => `${items[0].label}`,
                        label: (item) => `${item.raw} informe${item.raw !== 1 ? 's' : ''}`
                    }
                }
            },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
        },
        data: {
            labels: grupos.map(g => g.label),
            datasets: [{ label: `Informes por ${unidadLabel}`, data: grupos.map(g => g.conteo), borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 5 }]
        }
    });

    // Tabla: Informes por Curso (curso + división)
    const porCursoTabla = {};
    informes.forEach(i => {
        const alumno = getAlumno(i.alumno_id);
        if (!alumno) return;
        const key = `${alumno.curso} ${alumno.division}`;
        if (!porCursoTabla[key]) porCursoTabla[key] = { total: 0, leve: 0, grave: 0, muy_grave: 0, consejo_aula: 0, consejo: 0, curso: alumno.curso, division: alumno.division };
        porCursoTabla[key].total++;
        if (['leve','grave','muy_grave','consejo_aula','consejo'].includes(i.instancia)) porCursoTabla[key][i.instancia]++;
    });
    const filasCurso = Object.entries(porCursoTabla).sort((a, b) => {
        const na = parseInt(a[1].curso.replace('°', '')) || 0;
        const nb = parseInt(b[1].curso.replace('°', '')) || 0;
        if (na !== nb) return na - nb;
        return (a[1].division || '').localeCompare(b[1].division || '');
    });
    const tbodyCurso = document.getElementById('bodyInformesPorCurso');
    if (tbodyCurso) {
        tbodyCurso.innerHTML = filasCurso.length === 0
            ? '<tr><td colspan="8" class="px-4 py-6 text-center text-sm text-slate-400 italic">No hay informes registrados por curso.</td></tr>'
            : filasCurso.map(([cursoCompleto, stats], index) => `
                <tr class="hover:bg-slate-50">
                    <td class="px-4 py-3 text-center text-slate-400 font-medium">${index + 1}</td>
                    <td class="px-4 py-3 font-medium">${cursoCompleto}</td>
                    <td class="px-4 py-3 text-center font-bold">${stats.total}</td>
                    <td class="px-4 py-3 text-center text-amber-600">${stats.leve}</td>
                    <td class="px-4 py-3 text-center text-orange-600">${stats.grave}</td>
                    <td class="px-4 py-3 text-center text-red-600">${stats.muy_grave}</td>
                    <td class="px-4 py-3 text-center text-pink-600">${stats.consejo_aula}</td>
                    <td class="px-4 py-3 text-center text-purple-600">${stats.consejo}</td>
                </tr>
            `).join('');
    }

    const porAlumno = {};
    informes.forEach(i => {
        const alumno = getAlumno(i.alumno_id);
        if (!alumno) return;
        const key = `${alumno.apellido}, ${alumno.nombre}`;
        if (!porAlumno[key]) porAlumno[key] = { total: 0, leve: 0, grave: 0, muy_grave: 0, consejo_aula: 0, consejo: 0, curso: `${alumno.curso} ${alumno.division}`, id: alumno.id };
        porAlumno[key].total++;
        if (['leve','grave','muy_grave','consejo_aula','consejo'].includes(i.instancia)) porAlumno[key][i.instancia]++;
    });
    const topAlumnos = Object.entries(porAlumno).sort((a, b) => {
        const sa = a[1], sb = b[1];
        if (sb.total !== sa.total) return sb.total - sa.total;
        if (sb.consejo !== sa.consejo) return sb.consejo - sa.consejo;
        if (sb.consejo_aula !== sa.consejo_aula) return sb.consejo_aula - sa.consejo_aula;
        if (sb.muy_grave !== sa.muy_grave) return sb.muy_grave - sa.muy_grave;
        if (sb.grave !== sa.grave) return sb.grave - sa.grave;
        return sb.leve - sa.leve;
    }).slice(0, 10);
    document.getElementById('bodyTopAlumnos').innerHTML = topAlumnos.map(([nombre, stats], index) => `
        <tr class="hover:bg-slate-50 cursor-pointer" onclick="verAlumno('${stats.id}')">
            <td class="px-4 py-3 text-center text-slate-400 font-medium">${index + 1}</td>
            <td class="px-4 py-3 font-medium">${nombre}</td>
            <td class="px-4 py-3 text-slate-500">${stats.curso}</td>
            <td class="px-4 py-3 text-center font-bold">${stats.total}</td>
            <td class="px-4 py-3 text-center text-amber-600">${stats.leve}</td>
            <td class="px-4 py-3 text-center text-orange-600">${stats.grave}</td>
            <td class="px-4 py-3 text-center text-red-600">${stats.muy_grave}</td>
            <td class="px-4 py-3 text-center text-pink-600">${stats.consejo_aula}</td>
            <td class="px-4 py-3 text-center text-purple-600">${stats.consejo}</td>
        </tr>
    `).join('');
}

function cambiarPeriodoTendencia(dias) {
    periodoTendenciaDias = dias;
    document.querySelectorAll('.periodo-btn').forEach(btn => {
        const esActivo = parseInt(btn.dataset.dias) === dias;
        btn.classList.toggle('bg-white', esActivo);
        btn.classList.toggle('shadow-sm', esActivo);
        btn.classList.toggle('text-slate-800', esActivo);
        btn.classList.toggle('text-slate-600', !esActivo);
    });
    const titulo = document.getElementById('tituloTendencia');
    if (titulo) titulo.textContent = `Tendencia Últimos ${dias} Días`;
    cargarEstadisticas();
}

// ==================== VISTA ALUMNO ====================
function verAlumno(alumnoId) {
    mostrarSkeleton('vistaAlumno');
    alumnoActualId = alumnoId;
    const alumno = getAlumno(alumnoId);
    if (!alumno) { ocultarSkeleton('vistaAlumno'); return; }
    const lista = informes.filter(i => i.alumno_id === alumnoId).sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));
    const stats = { total: lista.length, leve: 0, grave: 0, muy_grave: 0, consejo_aula: 0, consejo: 0 };
    lista.forEach(i => { if (stats[i.instancia] !== undefined) stats[i.instancia]++; });

    const turnoColorDetalle = alumno.turno === 'Mañana' ? 'bg-amber-100 text-amber-700' : alumno.turno === 'Tarde' ? 'bg-orange-100 text-orange-700' : 'bg-indigo-100 text-indigo-700';
    document.getElementById('tarjetaAlumno').innerHTML = `
        <div class="flex items-center gap-4">
            <div class="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center text-white text-2xl font-bold">${alumno.nombre[0]}${alumno.apellido[0]}</div>
            <div>
                <h2 class="text-xl font-bold text-slate-800">${alumno.apellido}, ${alumno.nombre}</h2>
                <div class="flex items-center gap-2 mt-1">
                    <p class="text-slate-500">${alumno.curso} ${alumno.division}</p>
                    ${alumno.turno ? `<span class="text-xs px-2 py-0.5 rounded-md font-medium ${turnoColorDetalle}">${alumno.turno}</span>` : ''}
                    ${alumno.especialidad && alumno.especialidad !== 'Sin especialidad' ? `<span class="text-xs px-2 py-0.5 rounded-md font-medium bg-emerald-100 text-emerald-700">${escapeHtml(alumno.especialidad)}</span>` : ''}
                </div>
                <p class="text-sm text-slate-400 mt-1">${stats.total} informe${stats.total !== 1 ? 's' : ''} registrado${stats.total !== 1 ? 's' : ''}</p>
            </div>
        </div>
        <div class="grid grid-cols-5 gap-4 mt-6">
            <div class="text-center p-3 bg-amber-50 rounded-lg"><p class="text-2xl font-bold text-amber-600">${stats.leve}</p><p class="text-xs text-amber-700">Leves</p></div>
            <div class="text-center p-3 bg-orange-50 rounded-lg"><p class="text-2xl font-bold text-orange-600">${stats.grave}</p><p class="text-xs text-orange-700">Graves</p></div>
            <div class="text-center p-3 bg-red-50 rounded-lg"><p class="text-2xl font-bold text-red-600">${stats.muy_grave}</p><p class="text-xs text-red-700">Muy Graves</p></div>
            <div class="text-center p-3 bg-pink-50 rounded-lg"><p class="text-2xl font-bold text-pink-600">${stats.consejo_aula}</p><p class="text-xs text-pink-700">Consejo de Aula</p></div>
            <div class="text-center p-3 bg-purple-50 rounded-lg"><p class="text-2xl font-bold text-purple-600">${stats.consejo}</p><p class="text-xs text-purple-700">Consejo</p></div>
        </div>
    `;

    const ctx = document.getElementById('chartAlumno').getContext('2d');
    if (charts.alumno) charts.alumno.destroy();
    const chartLabels = ['Leve', 'Grave', 'Muy Grave', 'Consejo de Aula', 'Consejo Escolar'];
    const chartData = [stats.leve, stats.grave, stats.muy_grave, stats.consejo_aula, stats.consejo];
    const chartColors = ['#fbbf24', '#f97316', '#ef4444', '#db2777', '#7c3aed'];
    const instanciaPorLabel = { 'Leve': 'leve', 'Grave': 'grave', 'Muy Grave': 'muy_grave', 'Consejo de Aula': 'consejo_aula', 'Consejo Escolar': 'consejo' };
    charts.alumno = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: chartLabels, datasets: [{ data: chartData, backgroundColor: chartColors, borderWidth: 0 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (e, elements) => {
                if (!elements.length) return;
                const label = chartLabels[elements[0].index];
                const instancia = instanciaPorLabel[label];
                if (!instancia) return;
                const filtrados = lista.filter(i => i.instancia === instancia);
                if (filtrados.length) abrirModalGrupoInformes(filtrados);
            },
            plugins: { legend: { position: 'bottom' } }
        }
    });

    // ── Timeline: instancia vs tiempo ──
    const ctxTimeline = document.getElementById('chartAlumnoTimeline').getContext('2d');
    if (charts.alumnoTimeline) charts.alumnoTimeline.destroy();
    const nivelInstancia = { leve: 1, grave: 2, muy_grave: 3, consejo_aula: 4, consejo: 5 };
    const colorInstancia = { leve: '#fbbf24', grave: '#f97316', muy_grave: '#ef4444', consejo_aula: '#db2777', consejo: '#7c3aed' };
    const labelInstancia = { leve: 'Leve', grave: 'Grave', muy_grave: 'Muy Grave', consejo_aula: 'Consejo de Aula', consejo: 'Consejo Escolar de Convivencia' };

    const diaKey = (fecha) => {
        const d = new Date(fecha);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };

    // Agrupar informes por (dia, instancia) para mostrar un solo punto por grupo
    const grupos = new Map();
    lista.forEach(i => {
        const k = `${diaKey(i.fecha_creacion)}|${i.instancia}`;
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(i);
    });

    const puntos = [];
    grupos.forEach((informesGrupo, k) => {
        const instancia = informesGrupo[0].instancia;
        const avgX = informesGrupo.reduce((sum, i) => sum + new Date(i.fecha_creacion).getTime(), 0) / informesGrupo.length;
        puntos.push({
            x: avgX,
            y: nivelInstancia[instancia] ?? 4,
            instancia,
            informes: informesGrupo
        });
    });

    const crosshairPlugin = {
        id: 'crosshair',
        afterDraw: (chart) => {
            if (chart.tooltip?._active?.length) {
                const ctx = chart.ctx;
                const pt = chart.tooltip._active[0].element;
                const x = pt.x;
                const y = pt.y;
                const topY = chart.scales.y.top;
                const bottomY = chart.scales.y.bottom;
                const leftX = chart.scales.x.left;
                const rightX = chart.scales.x.right;
                ctx.save();
                ctx.beginPath();
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(100, 116, 139, 0.5)';
                ctx.moveTo(x, topY);
                ctx.lineTo(x, bottomY);
                ctx.moveTo(leftX, y);
                ctx.lineTo(rightX, y);
                ctx.stroke();
                ctx.restore();
            }
        }
    };

    charts.alumnoTimeline = new Chart(ctxTimeline, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Informes',
                data: puntos,
                backgroundColor: puntos.map(p => colorInstancia[p.instancia] ?? '#3b82f6'),
                pointRadius: puntos.map(p => p.informes.length > 1 ? 9 : 7),
                pointHoverRadius: 11
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (e, elements, chart) => {
                if (!elements.length) return;
                const punto = chart.data.datasets[elements[0].datasetIndex].data[elements[0].index];
                if (!punto || !punto.informes) return;
                if (punto.informes.length === 1) {
                    verDetalle(punto.informes[0].id);
                } else {
                    abrirModalGrupoInformes(punto.informes, punto.x);
                }
            },
            plugins: {
                legend: { display: false },
                crosshair: true,
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor: '#f8fafc',
                    bodyColor: '#f8fafc',
                    cornerRadius: 8,
                    padding: 10,
                    displayColors: true,
                    callbacks: {
                        title: (items) => formatearFechaCorta(new Date(items[0].raw.x)),
                        label: (item) => {
                            const g = item.raw.informes;
                            if (g.length === 1) {
                                return `Informe N° ${g[0].numero} • ${labelInstancia[g[0].instancia] ?? g[0].instancia} • ${g[0].titulo}`;
                            }
                            return `${g.length} informes ${labelInstancia[g[0].instancia] ?? g[0].instancia}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    ticks: {
                        callback: (v) => formatearFechaCorta(new Date(v)),
                        maxTicksLimit: 6
                    },
                    grid: { color: '#f1f5f9' }
                },
                y: {
                    min: 0.5,
                    max: 4.5,
                    ticks: {
                        stepSize: 1,
                        callback: (v) => {
                            const labels = { 1: 'Leve', 2: 'Grave', 3: 'Muy Grave' };
                            return labels[v] ?? '';
                        }
                    },
                    grid: { color: '#f1f5f9' }
                }
            }
        }
    });

    document.getElementById('historialAlumno').innerHTML = lista.map(i => `
        <div onclick="verDetalle('${i.id}')" class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 instancia-${escapeAttr(i.instancia)} cursor-pointer hover:shadow-md transition-all">
            <div class="flex flex-col sm:flex-row justify-between items-start gap-3">
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                        <span class="status-${escapeAttr(i.estado)} px-2 py-0.5 rounded-full text-xs font-medium capitalize">${escapeHtml(i.estado.replace('_', ' '))}</span>
                        <span class="text-xs text-slate-500">${formatearFechaCorta(i.fecha_creacion)}</span>
                        ${i.numero !== null && i.numero !== undefined ? `<span class="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">Informe N° ${escapeHtml(i.numero)}</span>` : `<span class="text-xs text-red-500 italic">Sin numerar</span>`}
                    </div>
                    <h4 class="font-semibold text-slate-800">${escapeHtml(i.titulo)}</h4>
                    <p class="text-sm text-slate-600 line-clamp-2">${escapeHtml(i.resumen)}</p>
                </div>
                <div class="flex items-center gap-2">
                    ${['muy_grave','consejo_aula','consejo'].includes(i.instancia) ? `<i class="mdi mdi-alert-outline ${i.instancia === 'muy_grave' ? 'text-red-500' : i.instancia === 'consejo_aula' ? 'text-pink-600' : 'text-purple-600'}" title="${i.instancia === 'muy_grave' ? 'Muy Grave' : i.instancia === 'consejo_aula' ? 'Consejo de Aula' : 'Consejo Escolar'}"></i>` : ''}
                    <i class="mdi mdi-chevron-right text-slate-400"></i>
                </div>
            </div>
        </div>
    `).join('');

    renderizarObservacionesAlumno(alumnoId);
    const esDocentePreceptorRegente = ['regente','docente','preceptor'].includes(getPerfil()?.rol);
    const btnToggle = document.getElementById('btnToggleFormObs');
    if (btnToggle) btnToggle.classList.toggle('hidden', !esDocentePreceptorRegente);
    document.getElementById('obsDescripcion').value = '';
    document.getElementById('obsFechaEvento').value = '';
    document.getElementById('obsTipo').value = 'observacion';
    document.getElementById('formObservacionAlumno').classList.add('hidden');

    cerrarModal();
    showSection('vistaAlumno');
    ocultarSkeleton('vistaAlumno');
}

function renderizarObservacionesAlumno(alumnoId) {
    const container = document.getElementById('listaObservacionesAlumno');
    if (!container) return;
    const lista = observacionesAlumnos.filter(o => o.alumno_id === alumnoId).sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));
    if (lista.length === 0) {
        container.innerHTML = '<p class="text-sm text-slate-400 italic">No hay observaciones ni acciones registradas.</p>';
        return;
    }
    const esRegente = getPerfil()?.rol === 'regente';
    container.innerHTML = lista.map(o => {
        const creador = o.creador ? `${escapeHtml(o.creador.apellido)}, ${escapeHtml(o.creador.nombre)}` : escapeHtml(getNombreUsuario(o.creado_por));
        const puedeEliminar = esRegente || o.creado_por === getPerfil()?.id;
        const tipoInfo = getTipoObservacionInfo(o.tipo);
        return `
        <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div class="flex items-start justify-between gap-2 flex-wrap mb-2">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="px-2 py-0.5 rounded-full text-xs font-medium capitalize" style="background-color:${escapeAttr(tipoInfo.color)}26;color:${escapeAttr(tipoInfo.color)}">${escapeHtml(tipoInfo.label)}</span>
                    <span class="text-xs text-slate-500">${formatearFechaCorta(o.fecha_creacion)}</span>
                    ${o.fecha_evento ? `<span class="text-xs text-slate-500"><i class="mdi mdi-calendar-outline mr-1"></i>${formatearFechaCorta(o.fecha_evento + 'T00:00:00')}</span>` : ''}
                </div>
                ${puedeEliminar ? `<button onclick="eliminarObservacionAlumno('${o.id}')" class="text-xs text-red-500 hover:text-red-700" title="Eliminar"><i class="mdi mdi-delete-outline"></i></button>` : ''}
            </div>
            <p class="text-sm text-slate-700 whitespace-pre-wrap">${escapeHtml(o.descripcion)}</p>
            <p class="text-xs text-slate-400 mt-2">Por: ${creador}</p>
        </div>`;
    }).join('');
}

function toggleFormObservacion() {
    const form = document.getElementById('formObservacionAlumno');
    if (form) form.classList.toggle('hidden');
}

async function guardarObservacionAlumno() {
    if (!USE_SUPABASE || !alumnoActualId) return;
    let tipo = document.getElementById('obsTipo').value;
    const descripcion = document.getElementById('obsDescripcion').value.trim();
    const fechaEvento = document.getElementById('obsFechaEvento').value || null;
    if (tipo === 'otro') {
        tipo = document.getElementById('obsTipoOtro').value.trim();
        if (!tipo) return mostrarToast('El tipo personalizado es obligatorio', 'error');
    }
    if (!descripcion) return mostrarToast('La descripción es obligatoria', 'error');
    if (descripcion.length > 1000) return mostrarToast('La descripción no puede superar los 1000 caracteres', 'error');

    const { error } = await supabaseClient.from('observaciones_alumno').insert({
        alumno_id: alumnoActualId,
        creado_por: getPerfil()?.id,
        tipo,
        descripcion,
        fecha_evento: fechaEvento
    });
    if (error) return mostrarToast('Error guardando observación', 'error');
    mostrarToast('Observación guardada correctamente');
    document.getElementById('obsDescripcion').value = '';
    document.getElementById('obsFechaEvento').value = '';
    document.getElementById('obsTipo').value = 'observacion';
    document.getElementById('obsTipoOtro').value = '';
    document.getElementById('obsTipoOtro').classList.add('hidden');
    toggleFormObservacion();
    await cargarObservacionesAlumnos();
    renderizarObservacionesAlumno(alumnoActualId);
}

function onChangeObsTipo(valor) {
    const otro = document.getElementById('obsTipoOtro');
    if (!otro) return;
    if (valor === 'otro') {
        otro.classList.remove('hidden');
        otro.focus();
    } else {
        otro.classList.add('hidden');
    }
}

async function eliminarObservacionAlumno(id) {
    if (!USE_SUPABASE || !confirm('¿Eliminar esta observación?')) return;
    const { error } = await supabaseClient.from('observaciones_alumno').delete().eq('id', id);
    if (error) return mostrarToast('Error eliminando observación', 'error');
    mostrarToast('Observación eliminada');
    await cargarObservacionesAlumnos();
    if (alumnoActualId) renderizarObservacionesAlumno(alumnoActualId);
}

function renderizarSelectTiposObservacion() {
    const select = document.getElementById('obsTipo');
    if (!select) return;
    const tiposPersonalizados = tiposObservacion.map(t => `<option value="${escapeAttr(t.nombre)}">${escapeHtml(t.nombre)}</option>`).join('');
    const tiposDefault = [
        { value: 'observacion', label: 'Observación' },
        { value: 'accion', label: 'Acción' },
        { value: 'seguimiento', label: 'Seguimiento' },
        { value: 'llamado_padres', label: 'Llamado a padres' },
        { value: 'entrevista', label: 'Entrevista' },
        { value: 'notificacion', label: 'Notificación' },
        { value: 'derivacion', label: 'Derivación' },
        { value: 'suspension', label: 'Suspensión' }
    ];
    const defaultOptions = tiposDefault.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
    select.innerHTML = defaultOptions + (tiposPersonalizados ? '<optgroup label="Personalizados">' + tiposPersonalizados + '</optgroup>' : '');
}

function getTipoObservacionInfo(tipoNombre) {
    const encontrado = tiposObservacion.find(t => t.nombre.toLowerCase() === (tipoNombre || '').toLowerCase());
    if (encontrado) return { label: encontrado.nombre, color: encontrado.color };
    const defaults = {
        observacion: { label: 'Observación', color: '#64748b' },
        accion: { label: 'Acción', color: '#3b82f6' },
        seguimiento: { label: 'Seguimiento', color: '#6366f1' },
        llamado_padres: { label: 'Llamado a padres', color: '#f59e0b' },
        entrevista: { label: 'Entrevista', color: '#22c55e' },
        notificacion: { label: 'Notificación', color: '#06b6d4' },
        derivacion: { label: 'Derivación', color: '#f97316' },
        suspension: { label: 'Suspensión', color: '#ef4444' }
    };
    return defaults[tipoNombre] || { label: tipoNombre, color: '#64748b' };
}

function abrirModalTiposObservacion() {
    document.getElementById('modalTiposObservacion').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    renderizarListaTiposObservacion();
}

function cerrarModalTiposObservacion() {
    document.getElementById('modalTiposObservacion').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

async function crearTipoObservacion() {
    if (!USE_SUPABASE) return;
    const nombre = document.getElementById('newTipoObsNombre').value.trim();
    const color = document.getElementById('newTipoObsColor').value;
    if (!nombre) return mostrarToast('El nombre es obligatorio', 'error');
    if (tiposObservacion.some(t => t.nombre.toLowerCase() === nombre.toLowerCase())) return mostrarToast('Ya existe un tipo con ese nombre', 'error');

    const { error } = await supabaseClient.from('tipos_observacion_alumno').insert({ nombre, color });
    if (error) return mostrarToast('Error creando tipo', 'error');
    mostrarToast('Tipo creado correctamente');
    document.getElementById('newTipoObsNombre').value = '';
    await cargarTiposObservacion();
    renderizarListaTiposObservacion();
}

async function eliminarTipoObservacion(id) {
    if (!USE_SUPABASE || !confirm('¿Eliminar este tipo de observación?')) return;
    const { error } = await supabaseClient.from('tipos_observacion_alumno').update({ activo: false }).eq('id', id);
    if (error) return mostrarToast('Error eliminando tipo', 'error');
    mostrarToast('Tipo eliminado');
    await cargarTiposObservacion();
    renderizarListaTiposObservacion();
}

function renderizarListaTiposObservacion() {
    const container = document.getElementById('listaTiposObservacion');
    if (!container) return;
    if (tiposObservacion.length === 0) {
        container.innerHTML = '<p class="text-sm text-slate-400 italic">No hay tipos personalizados.</p>';
        return;
    }
    container.innerHTML = tiposObservacion.map(t => `
        <div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div class="flex items-center gap-3">
                <span class="w-4 h-4 rounded-full inline-block" style="background-color:${escapeAttr(t.color)};"></span>
                <span class="text-sm font-medium text-slate-700">${escapeHtml(t.nombre)}</span>
            </div>
            <button onclick="eliminarTipoObservacion('${t.id}')" class="text-xs text-red-500 hover:text-red-700"><i class="mdi mdi-delete-outline"></i></button>
        </div>
    `).join('');
}

function verDocente(userId) {
    mostrarSkeleton('vistaDocente');
    const u = usuarios.find(x => x.id === userId);
    if (!u) { ocultarSkeleton('vistaDocente'); return; }
    const lista = informes.filter(i => i.creado_por === userId).sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));
    const stats = { total: lista.length, pendiente: 0, revisado: 0, derivado: 0, final: 0 };
    lista.forEach(i => {
        if (i.estado === 'pendiente') stats.pendiente++;
        else if (i.estado === 'revisado') stats.revisado++;
        else if (i.estado === 'derivado') stats.derivado++;
        else if (['archivado', 'anulado'].includes(i.estado)) stats.final++;
    });

    const rolColor = { regente: 'bg-purple-100 text-purple-700', preceptor: 'bg-blue-100 text-blue-700', docente: 'bg-green-100 text-green-700', doe: 'bg-orange-100 text-orange-700', pat: 'bg-teal-100 text-teal-700' };
    const avatarColor = { regente: 'bg-purple-500', preceptor: 'bg-blue-500', docente: 'bg-green-500', doe: 'bg-orange-500', pat: 'bg-teal-500' };
    const alumnosPat = (u.alumnos_pat || []).map(id => getAlumno(id)).filter(Boolean).sort((a, b) => `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`));
    document.getElementById('tarjetaDocente').innerHTML = `
        <div class="flex items-center gap-4">
            <div class="w-16 h-16 ${avatarColor[u.rol] || 'bg-slate-500'} rounded-full flex items-center justify-center text-white text-2xl font-bold">${(u.nombre || '?')[0]}${(u.apellido || '?')[0]}</div>
            <div class="flex-1 min-w-0">
                <h2 class="text-xl font-bold text-slate-800">${u.apellido || ''}, ${u.nombre || ''}</h2>
                <div class="flex items-center gap-2 mt-1">
                    <p class="text-slate-500">${u.email}</p>
                    ${u.rol ? `<span class="text-xs px-2 py-0.5 rounded-md font-medium ${rolColor[u.rol] || 'bg-slate-100 text-slate-600'}">${u.rol}</span>` : ''}
                </div>
                <div class="flex flex-wrap gap-1.5 mt-2">
                    ${(u.cursos || []).length > 0
                        ? (u.cursos || []).map(c => `<span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 font-medium">${c}</span>`).join('')
                        : '<span class="text-xs text-slate-400 italic">Sin cursos asignados</span>'}
                </div>
                ${u.rol === 'pat' ? `
                <div class="mt-2">
                    <p class="text-xs font-medium text-slate-600 mb-1">Alumnos asignados (${alumnosPat.length})</p>
                    <div class="flex flex-wrap gap-1 max-h-32 overflow-y-auto pr-1">
                        ${alumnosPat.length > 0
                            ? alumnosPat.map(a => `<span onclick="verAlumno('${a.id}')" class="text-[10px] px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-100 font-medium cursor-pointer hover:bg-teal-100 transition-colors" title="${a.curso || ''} ${a.division || ''}">${a.apellido}, ${a.nombre}</span>`).join('')
                            : '<span class="text-xs text-slate-400 italic">Sin alumnos asignados</span>'}
                    </div>
                </div>
                ` : ''}
                <p class="text-sm text-slate-400 mt-1">${stats.total} informe${stats.total !== 1 ? 's' : ''} creado${stats.total !== 1 ? 's' : ''}</p>
            </div>
        </div>
        <div class="grid grid-cols-4 gap-4 mt-6">
            <div class="text-center p-3 bg-amber-50 rounded-lg"><p class="text-2xl font-bold text-amber-600">${stats.pendiente}</p><p class="text-xs text-amber-700">Pendientes</p></div>
            <div class="text-center p-3 bg-blue-50 rounded-lg"><p class="text-2xl font-bold text-blue-600">${stats.revisado}</p><p class="text-xs text-blue-700">Revisados</p></div>
            <div class="text-center p-3 bg-green-50 rounded-lg"><p class="text-2xl font-bold text-green-600">${stats.derivado}</p><p class="text-xs text-green-700">Derivados</p></div>
            <div class="text-center p-3 bg-slate-50 rounded-lg"><p class="text-2xl font-bold text-slate-600">${stats.final}</p><p class="text-xs text-slate-700">Finales</p></div>
        </div>
    `;

    const ctx = document.getElementById('chartDocenteEstado').getContext('2d');
    if (charts.docenteEstado) charts.docenteEstado.destroy();
    const estadoLabels = ['Pendiente', 'Revisado', 'Derivado', 'Final'];
    const estadoData = [stats.pendiente, stats.revisado, stats.derivado, stats.final];
    const estadoColors = ['#fbbf24', '#3b82f6', '#22c55e', '#94a3b8'];
    charts.docenteEstado = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: estadoLabels, datasets: [{ data: estadoData, backgroundColor: estadoColors, borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });

    const ctxTimeline = document.getElementById('chartDocenteTimeline').getContext('2d');
    if (charts.docenteTimeline) charts.docenteTimeline.destroy();
    const nivelInstancia = { leve: 1, grave: 2, muy_grave: 3, consejo_aula: 4, consejo: 5 };
    const colorInstancia = { leve: '#fbbf24', grave: '#f97316', muy_grave: '#ef4444', consejo_aula: '#db2777', consejo: '#7c3aed' };
    const labelInstancia = { leve: 'Leve', grave: 'Grave', muy_grave: 'Muy Grave', consejo_aula: 'Consejo de Aula', consejo: 'Consejo Escolar de Convivencia' };

    const diaKey = (fecha) => {
        const d = new Date(fecha);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };
    const grupos = new Map();
    lista.forEach(i => {
        const k = `${diaKey(i.fecha_creacion)}|${i.instancia}`;
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(i);
    });
    const puntos = [];
    grupos.forEach((informesGrupo, k) => {
        const instancia = informesGrupo[0].instancia;
        const avgX = informesGrupo.reduce((sum, i) => sum + new Date(i.fecha_creacion).getTime(), 0) / informesGrupo.length;
        puntos.push({ x: avgX, y: nivelInstancia[instancia] ?? 4, instancia, informes: informesGrupo });
    });

    const crosshairPlugin = {
        id: 'crosshair',
        afterDraw: (chart) => {
            if (chart.tooltip?._active?.length) {
                const ctx = chart.ctx;
                const pt = chart.tooltip._active[0].element;
                const x = pt.x, y = pt.y;
                const topY = chart.scales.y.top, bottomY = chart.scales.y.bottom;
                const leftX = chart.scales.x.left, rightX = chart.scales.x.right;
                ctx.save();
                ctx.beginPath();
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(100, 116, 139, 0.5)';
                ctx.moveTo(x, topY); ctx.lineTo(x, bottomY);
                ctx.moveTo(leftX, y); ctx.lineTo(rightX, y);
                ctx.stroke();
                ctx.restore();
            }
        }
    };

    charts.docenteTimeline = new Chart(ctxTimeline, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Informes',
                data: puntos,
                backgroundColor: puntos.map(p => colorInstancia[p.instancia] ?? '#3b82f6'),
                pointRadius: puntos.map(p => p.informes.length > 1 ? 9 : 7),
                pointHoverRadius: 11
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            onClick: (e, elements, chart) => {
                if (!elements.length) return;
                const punto = chart.data.datasets[elements[0].datasetIndex].data[elements[0].index];
                if (!punto || !punto.informes) return;
                if (punto.informes.length === 1) { verDetalle(punto.informes[0].id); }
                else { abrirModalGrupoInformes(punto.informes, punto.x); }
            },
            plugins: {
                legend: { display: false }, crosshair: true,
                tooltip: {
                    backgroundColor: '#1e293b', titleColor: '#f8fafc', bodyColor: '#f8fafc', cornerRadius: 8, padding: 10, displayColors: true,
                    callbacks: {
                        title: (items) => formatearFechaCorta(new Date(items[0].raw.x)),
                        label: (item) => {
                            const g = item.raw.informes;
                            if (g.length === 1) return `Informe N° ${g[0].numero} • ${labelInstancia[g[0].instancia] ?? g[0].instancia} • ${g[0].titulo}`;
                            return `${g.length} informes ${labelInstancia[g[0].instancia] ?? g[0].instancia}`;
                        }
                    }
                }
            },
            scales: {
                x: { type: 'linear', ticks: { callback: (v) => formatearFechaCorta(new Date(v)), maxTicksLimit: 6 }, grid: { color: '#f1f5f9' } },
                y: { min: 0.5, max: 4.5, ticks: { stepSize: 1, callback: (v) => { const labels = { 1: 'Leve', 2: 'Grave', 3: 'Muy Grave' }; return labels[v] ?? ''; } }, grid: { color: '#f1f5f9' } }
            }
        }
    });

    document.getElementById('historialDocente').innerHTML = lista.map(i => {
        const alumno = getAlumno(i.alumno_id);
        return `
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 instancia-${i.instancia}">
            <div class="flex items-center gap-2 mb-1 flex-wrap">
                <span class="status-${i.estado} px-2 py-0.5 rounded-full text-xs font-medium capitalize">${i.estado.replace('_', ' ')}</span>
                <span class="text-xs text-slate-500">${formatearFechaCorta(i.fecha_creacion)}</span>
                ${i.numero !== null && i.numero !== undefined ? `<span class="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">Informe N° ${i.numero}</span>` : `<span class="text-xs text-red-500 italic">Sin numerar</span>`}
            </div>
            <h4 class="font-semibold text-slate-800">${i.titulo}</h4>
            <p class="text-sm text-slate-600 line-clamp-2">${i.resumen}</p>
            <p class="text-xs text-slate-500 mt-1">${alumno ? `${alumno.apellido}, ${alumno.nombre} · ${alumno.curso} ${alumno.division}${alumno.especialidad && alumno.especialidad !== 'Sin especialidad' ? ' · ' + alumno.especialidad : ''}` : 'Alumno desconocido'}</p>
            <button onclick="verDetalle('${i.id}')" class="text-sm text-blue-600 hover:text-blue-700 mt-2">Ver detalle <i class="mdi mdi-arrow-right text-xs"></i></button>
        </div>
    `;
    }).join('');

    showSection('vistaDocente');
    ocultarSkeleton('vistaDocente');
}

// ==================== DOCENTES ====================
async function cargarDocentes() {
    await cargarUsuariosSupa();
    filtrarDocentes();
}

function filtrarDocentes() {
    const busqueda = (document.getElementById('filtroDocenteNombre')?.value || '').toLowerCase().trim();
    const rol = document.getElementById('filtroDocenteRol')?.value || '';
    const orden = document.getElementById('ordenDocentes')?.value || 'nombre_asc';

    let lista = usuarios.filter(u => {
        const matchBusqueda = !busqueda ||
            `${u.nombre || ''} ${u.apellido || ''}`.toLowerCase().includes(busqueda) ||
            (u.email || '').toLowerCase().includes(busqueda);
        const matchRol = !rol || u.rol === rol;
        return matchBusqueda && matchRol;
    });

    lista = lista.map(u => {
        const creados = informes.filter(i => i.creado_por === u.id).length;
        const pendientes = informes.filter(i => i.creado_por === u.id && i.estado === 'pendiente').length;
        const revisados = informes.filter(i => i.creado_por === u.id && i.estado === 'revisado').length;
        const derivados = informes.filter(i => i.creado_por === u.id && i.estado === 'derivado').length;
        const finales = informes.filter(i => i.revisado_por === u.id && ['archivado', 'anulado'].includes(i.estado)).length;
        return { ...u, creados, pendientes, revisados, derivados, finales };
    });

    lista.sort((a, b) => {
        if (orden === 'nombre_asc') return `${a.apellido || ''}, ${a.nombre || ''}`.localeCompare(`${b.apellido || ''}, ${b.nombre || ''}`);
        if (orden === 'nombre_desc') return `${b.apellido || ''}, ${b.nombre || ''}`.localeCompare(`${a.apellido || ''}, ${a.nombre || ''}`);
        if (orden === 'rol_asc') return (a.rol || '').localeCompare(b.rol || '');
        if (orden === 'rol_desc') return (b.rol || '').localeCompare(a.rol || '');
        if (orden === 'informes_desc') return b.creados - a.creados;
        if (orden === 'informes_asc') return a.creados - b.creados;
        return 0;
    });

    const rolColor = { regente: 'bg-purple-100 text-purple-700', preceptor: 'bg-blue-100 text-blue-700', docente: 'bg-green-100 text-green-700', doe: 'bg-orange-100 text-orange-700', pat: 'bg-teal-100 text-teal-700' };
    const rolLabel = { regente: 'Regente', preceptor: 'Preceptor', docente: 'Docente', doe: 'DOE', pat: 'PAT' };

    const nombreCompleto = (u) => `${u.apellido || ''}, ${u.nombre || ''}`;

    document.getElementById('listaDocentesDesktop').innerHTML = lista.map(u => `
        <tr class="hover:bg-slate-50 transition-colors cursor-pointer" onclick="verDocente('${u.id}')">
            <td class="px-4 py-3 font-medium">${nombreCompleto(u)}</td>
            <td class="px-4 py-3 text-slate-500">${u.email}</td>
            <td class="px-4 py-3"><span class="px-2 py-1 rounded-full text-xs font-medium capitalize ${rolColor[u.rol] || 'bg-slate-100 text-slate-600'}">${rolLabel[u.rol] || u.rol}</span></td>
            <td class="px-4 py-3 text-center font-semibold text-slate-700">${u.creados}</td>
            <td class="px-4 py-3 text-center"><span class="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">${u.pendientes}</span></td>
            <td class="px-4 py-3 text-center"><span class="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">${u.revisados}</span></td>
            <td class="px-4 py-3 text-center"><span class="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">${u.derivados}</span></td>
            <td class="px-4 py-3 text-center"><span class="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">${u.finales}</span></td>
        </tr>
    `).join('');

    document.getElementById('listaDocentesMobile').innerHTML = lista.map(u => `
        <div class="p-4 cursor-pointer" onclick="verDocente('${u.id}')">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                    <p class="font-medium text-slate-800 text-sm">${nombreCompleto(u)}</p>
                    <p class="text-xs text-slate-500 mt-0.5 truncate">${u.email}</p>
                    <div class="mt-2">${u.rol ? `<span class="px-2 py-1 rounded-full text-xs font-medium capitalize ${rolColor[u.rol] || 'bg-slate-100 text-slate-600'}">${rolLabel[u.rol] || u.rol}</span>` : ''}</div>
                </div>
            </div>
            <div class="grid grid-cols-5 gap-2 mt-3 pt-3 border-t border-slate-100 text-center">
                <div><p class="text-lg font-bold text-slate-700">${u.creados}</p><p class="text-[10px] text-slate-500 uppercase">Creados</p></div>
                <div><p class="text-lg font-bold text-amber-600">${u.pendientes}</p><p class="text-[10px] text-slate-500 uppercase">Pendientes</p></div>
                <div><p class="text-lg font-bold text-blue-600">${u.revisados}</p><p class="text-[10px] text-slate-500 uppercase">Revisados</p></div>
                <div><p class="text-lg font-bold text-green-600">${u.derivados}</p><p class="text-[10px] text-slate-500 uppercase">Derivados</p></div>
                <div><p class="text-lg font-bold text-slate-600">${u.finales}</p><p class="text-[10px] text-slate-500 uppercase">Finales</p></div>
            </div>
        </div>
    `).join('');

    const empty = document.getElementById('docentesEmpty');
    if (lista.length === 0) {
        document.getElementById('listaDocentesDesktop').innerHTML = '';
        document.getElementById('listaDocentesMobile').innerHTML = '';
        empty?.classList.remove('hidden');
    } else {
        empty?.classList.add('hidden');
    }
}

// ==================== USUARIOS ====================
async function cargarUsuarios() {
    if (!esRegente()) return;
    await cargarUsuariosSupa();

    const rolColor = { regente: 'bg-purple-100 text-purple-700', preceptor: 'bg-blue-100 text-blue-700', docente: 'bg-green-100 text-green-700', doe: 'bg-orange-100 text-orange-700', pat: 'bg-teal-100 text-teal-700' };
    const rolLabel = { regente: 'Regente', preceptor: 'Preceptor', docente: 'Docente', doe: 'DOE', pat: 'PAT' };
    const perfilActual = getPerfil();

    const lista = [...usuarios].sort((a, b) => `${a.apellido || ''}, ${a.nombre || ''}`.localeCompare(`${b.apellido || ''}, ${b.nombre || ''}`));

    document.getElementById('listaUsuariosDesktop').innerHTML = lista.map(u => {
        const puedeModificar = u.id !== perfilActual?.id && u.email !== 'admin@gie.com';
        const btnEditar = `<button onclick="abrirModalUsuario('${u.id}')" class="text-sm font-medium text-blue-600 hover:text-blue-700 mr-3" title="Editar"><i class="mdi mdi-pencil-outline mr-1"></i>Editar</button>`;
        const btnEliminar = puedeModificar
            ? `<button onclick="eliminarUsuario('${u.id}')" class="text-sm font-medium text-red-600 hover:text-red-700 mr-3" title="Eliminar definitivamente"><i class="mdi mdi-delete-outline mr-1"></i>Eliminar</button>`
            : '';
        const accion = puedeModificar
            ? `${btnEditar}${btnEliminar}<button onclick="toggleUsuario('${u.id}', ${u.activo === false})" class="text-sm font-medium ${u.activo === false ? 'text-green-600 hover:text-green-700' : 'text-red-600 hover:text-red-700'}">${u.activo === false ? 'Activar' : 'Desactivar'}</button>`
            : `${btnEditar}<span class="text-xs text-slate-400">-</span>`;
        return `
        <tr id="fila-usuario-${u.id}" class="hover:bg-slate-50 transition-colors">
            <td class="px-4 py-3 font-medium truncate" title="${escapeAttr(u.apellido || '')}, ${escapeAttr(u.nombre || '')}">${escapeHtml(u.apellido || '')}, ${escapeHtml(u.nombre || '')}</td>
            <td class="px-4 py-3 text-slate-500 truncate" title="${escapeAttr(u.email)}">${escapeHtml(u.email)}</td>
            <td class="px-4 py-3"><span class="px-2 py-1 rounded-full text-xs font-medium capitalize ${rolColor[u.rol] || 'bg-slate-100 text-slate-600'}">${escapeHtml(rolLabel[u.rol] || u.rol)}</span></td>
            <td class="px-4 py-3"><span class="px-2 py-1 rounded-full text-xs font-medium ${u.activo === false ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}">${u.activo === false ? 'Inactivo' : 'Activo'}</span></td>
            <td class="px-4 py-3 text-center whitespace-nowrap overflow-hidden text-ellipsis">${accion}</td>
        </tr>
    `;
    }).join('');

    document.getElementById('listaUsuariosMobile').innerHTML = lista.map(u => {
        const puedeModificar = u.id !== perfilActual?.id && u.email !== 'admin@gie.com';
        const btnEditar = `<button onclick="abrirModalUsuario('${u.id}')" class="text-xs font-medium text-blue-600 hover:text-blue-700 mr-2" title="Editar"><i class="mdi mdi-pencil-outline mr-1"></i>Editar</button>`;
        const btnEliminar = puedeModificar
            ? `<button onclick="eliminarUsuario('${u.id}')" class="text-xs font-medium text-red-600 hover:text-red-700 mr-2" title="Eliminar definitivamente"><i class="mdi mdi-delete-outline mr-1"></i>Eliminar</button>`
            : '';
        const accion = puedeModificar
            ? `${btnEditar}${btnEliminar}<button onclick="toggleUsuario('${u.id}', ${u.activo === false})" class="text-xs font-medium ${u.activo === false ? 'text-green-600 hover:text-green-700' : 'text-red-600 hover:text-red-700'}">${u.activo === false ? 'Activar' : 'Desactivar'}</button>`
            : `${btnEditar}`;
        return `
        <div id="tarjeta-usuario-${u.id}" class="p-4">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                    <p class="font-medium text-slate-800 text-sm">${escapeHtml(u.apellido || '')}, ${escapeHtml(u.nombre || '')}</p>
                    <p class="text-xs text-slate-500 mt-0.5 truncate">${escapeHtml(u.email)}</p>
                    <div class="mt-2 flex items-center gap-2">
                        ${u.rol ? `<span class="px-2 py-1 rounded-full text-xs font-medium capitalize ${rolColor[u.rol] || 'bg-slate-100 text-slate-600'}">${escapeHtml(rolLabel[u.rol] || u.rol)}</span>` : ''}
                        <span class="px-2 py-1 rounded-full text-xs font-medium ${u.activo === false ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}">${u.activo === false ? 'Inactivo' : 'Activo'}</span>
                    </div>
                    ${accion ? `<div class="mt-2">${accion}</div>` : ''}
                </div>
            </div>
        </div>
    `;
    }).join('');

    const empty = document.getElementById('usuariosEmpty');
    if (lista.length === 0) {
        document.getElementById('listaUsuariosDesktop').innerHTML = '';
        document.getElementById('listaUsuariosMobile').innerHTML = '';
        empty?.classList.remove('hidden');
    } else {
        empty?.classList.add('hidden');
    }
}

window.crearUsuario = async function() {
    if (!esRegente()) return mostrarToast('Solo el regente puede crear usuarios', 'error');

    const email = document.getElementById('newUsuarioEmail').value.trim().toLowerCase();
    const password = document.getElementById('newUsuarioPassword').value;
    const nombre = document.getElementById('newUsuarioNombre').value.trim();
    const apellido = document.getElementById('newUsuarioApellido').value.trim();
    const rol = document.getElementById('newUsuarioRol').value;

    if (!email || !nombre || !apellido || !rol) {
        return mostrarToast('Completá email, nombre, apellido y rol', 'error');
    }
    if (!esPasswordValida(password)) {
        return mostrarToast('La contraseña es requerida', 'error');
    }

    mostrarToast('Creando usuario...', 'info');

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch(`${GIE_URL}/functions/v1/crear-usuario`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token || ''}`
            },
            body: JSON.stringify({ email, password, nombre, apellido, rol })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);

        document.getElementById('newUsuarioEmail').value = '';
        document.getElementById('newUsuarioPassword').value = '';
        document.getElementById('newUsuarioNombre').value = '';
        document.getElementById('newUsuarioApellido').value = '';
        document.getElementById('newUsuarioRol').value = 'docente';

        await cargarUsuarios();
        mostrarToast('Usuario creado correctamente', 'success');
    } catch (err) {
        mostrarToast(err.message || 'Error creando usuario', 'error');
    }
};

window.toggleUsuario = function(id, activo) {
    if (!esRegente()) return mostrarToast('Solo el regente puede cambiar el estado', 'error');
    abrirModalConfirmarEstadoUsuario(id, activo);
};

function abrirModalConfirmarEstadoUsuario(userId, activo) {
    if (!esRegente()) return;
    const u = usuarios.find(x => x.id === userId);
    if (!u) return;
    if (u.id === getPerfil()?.id) return mostrarToast('No podés cambiar tu propio estado', 'error');
    if (u.email === 'admin@gie.com') return mostrarToast('No podés desactivar al administrador', 'error');

    document.getElementById('estadoUsuarioId').value = userId;
    document.getElementById('estadoUsuarioActivo').value = activo ? 'true' : 'false';

    const iconoContainer = document.getElementById('iconoConfirmarEstadoUsuario');
    const iconoInner = document.getElementById('iconoConfirmarEstadoUsuarioInner');
    const titulo = document.getElementById('tituloConfirmarEstadoUsuario');
    const texto = document.getElementById('textoConfirmarEstadoUsuario');
    const btn = document.getElementById('btnConfirmarEstadoUsuario');

    if (activo) {
        iconoContainer.className = 'w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4';
        iconoInner.className = 'mdi mdi-check-circle-outline text-green-600 text-xl';
        titulo.textContent = '¿Activar usuario?';
        texto.innerHTML = `¿Confirmás que querés activar a <span class="font-medium text-slate-700">${escapeHtml(u.apellido || '')}, ${escapeHtml(u.nombre || '')}</span>?`;
        btn.className = 'flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors';
        btn.textContent = 'Activar';
    } else {
        iconoContainer.className = 'w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4';
        iconoInner.className = 'mdi mdi-alert-outline text-amber-600 text-xl';
        titulo.textContent = '¿Desactivar usuario?';
        texto.innerHTML = `¿Confirmás que querés desactivar a <span class="font-medium text-slate-700">${escapeHtml(u.apellido || '')}, ${escapeHtml(u.nombre || '')}</span>?`;
        btn.className = 'flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors';
        btn.textContent = 'Desactivar';
    }

    document.getElementById('modalConfirmarEstadoUsuario').classList.remove('hidden');
}

function cerrarModalConfirmarEstadoUsuario() {
    document.getElementById('modalConfirmarEstadoUsuario').classList.add('hidden');
}

window.confirmarCambioEstadoUsuario = async function() {
    const id = document.getElementById('estadoUsuarioId').value;
    const activo = document.getElementById('estadoUsuarioActivo').value === 'true';

    cerrarModalConfirmarEstadoUsuario();

    if (!esRegente()) return mostrarToast('Solo el regente puede cambiar el estado', 'error');
    const u = usuarios.find(x => x.id === id);
    if (!u) return;
    if (u.id === getPerfil()?.id) return mostrarToast('No podés cambiar tu propio estado', 'error');
    if (u.email === 'admin@gie.com') return mostrarToast('No podés desactivar al administrador', 'error');

    const { error } = await supabaseClient.from('perfiles').update({ activo }).eq('id', id);
    if (error) return mostrarToast(error.message, 'error');

    // Actualizar estado local inmediatamente para que el botón cambie sin esperar recarga
    const idx = usuarios.findIndex(x => x.id === id);
    if (idx !== -1) {
        usuarios[idx] = { ...usuarios[idx], activo };
    }

    await cargarUsuarios();
    mostrarToast(`Usuario ${activo ? 'activado' : 'desactivado'}`, 'success');
};

let _cursosAjustes = [];

function renderizarChipsCursos(containerId, cursos, onRemove) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (cursos.length === 0) {
        container.innerHTML = '<span class="text-xs text-slate-400 italic">Sin cursos asignados</span>';
        return;
    }
    container.innerHTML = cursos.map(c => `
        <span class="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full border border-blue-100">
            ${c}
            <button onclick="${onRemove}('${c}')" class="hover:text-blue-900 ml-0.5" title="Quitar"><i class="mdi mdi-close"></i></button>
        </span>
    `).join('');
}

function _normalizarArrayUUIDs(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(x => x != null).map(x => String(x).trim()).filter(x => x.length > 0);
}

function renderizarChipsAlumnosPAT(containerId, alumnoIds, onRemove) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const ids = _normalizarArrayUUIDs(alumnoIds);
    if (ids.length === 0) {
        container.innerHTML = '<span class="text-xs text-slate-400 italic">Sin alumnos asignados</span>';
        return;
    }
    container.innerHTML = ids.map(id => {
        const a = alumnos.find(x => x.id === id);
        const labelRaw = a ? `${a.apellido}, ${a.nombre}` : id;
        const label = escapeHtml(labelRaw);
        return `
        <span class="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium px-2.5 py-1 rounded-full border border-indigo-100">
            ${label}
            <button onclick="${escapeAttr(onRemove)}('${escapeJsString(id)}')" class="hover:text-indigo-900 ml-0.5" title="Quitar"><i class="mdi mdi-close"></i></button>
        </span>`;
    }).join('');
}

function _buscarAlumnoGenerico(query, resultadosId, onSelectFn) {
    const resultados = document.getElementById(resultadosId);
    if (!query || query.length < 1) { resultados?.classList.add('hidden'); return; }
    const filtrados = alumnos.filter(a =>
        `${a.nombre} ${a.apellido}`.toLowerCase().includes(query.toLowerCase()) ||
        `${a.apellido} ${a.nombre}`.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 10);
    if (!resultados) return;
    if (filtrados.length === 0) {
        resultados.innerHTML = '<div class="p-3 text-sm text-slate-500">No se encontraron alumnos</div>';
    } else {
        resultados.innerHTML = filtrados.map(a => `
            <div tabindex="0"
                onclick="${escapeAttr(onSelectFn)}('${escapeJsString(a.id)}', '${escapeJsString(a.nombre)}', '${escapeJsString(a.apellido)}')"
                class="p-3 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0 outline-none">
                <p class="font-medium text-sm">${escapeHtml(a.apellido)}, ${escapeHtml(a.nombre)}</p>
                <p class="text-xs text-slate-500">${escapeHtml(a.curso || '')} ${escapeHtml(a.division || '')}${a.turno ? ' · ' + escapeHtml(a.turno) : ''}${a.especialidad && a.especialidad !== 'Sin especialidad' ? ' · ' + escapeHtml(a.especialidad) : ''}</p>
            </div>`).join('');
    }
    resultados.classList.remove('hidden');
}

// ==================== GESTIÓN DE USUARIOS ====================
let _usuarioEdicionId = null;
let _cursosUsuario = [];
let _alumnosPATUsuario = [];

function abrirModalUsuario(userId = null) {
    if (!esRegente()) return mostrarToast('Solo el regente puede gestionar usuarios', 'error');

    _usuarioEdicionId = userId || null;
    _cursosUsuario = [];
    _alumnosPATUsuario = [];

    const titulo = document.getElementById('tituloModalUsuario');
    const emailInput = document.getElementById('usuarioEmail');
    const passInput = document.getElementById('usuarioPassword');
    const passRequerido = document.getElementById('usuarioPasswordRequerido');
    const passHint = document.getElementById('usuarioPasswordHint');

    emailInput.disabled = !!userId;
    passInput.value = '';

    if (userId) {
        const u = usuarios.find(x => x.id === userId);
        if (!u) return mostrarToast('Usuario no encontrado', 'error');
        titulo.textContent = 'Editar usuario';
        emailInput.value = u.email || '';
        document.getElementById('usuarioNombre').value = u.nombre || '';
        document.getElementById('usuarioApellido').value = u.apellido || '';
        document.getElementById('usuarioRol').value = u.rol || 'docente';
        document.getElementById('usuarioActivo').checked = u.activo !== false;
        _cursosUsuario = Array.isArray(u.cursos) ? [...u.cursos] : [];
        _alumnosPATUsuario = Array.isArray(u.alumnos_pat) ? [...u.alumnos_pat] : [];
        passRequerido.classList.add('hidden');
        passHint.classList.remove('hidden');
    } else {
        titulo.textContent = 'Nuevo usuario';
        emailInput.value = '';
        document.getElementById('usuarioNombre').value = '';
        document.getElementById('usuarioApellido').value = '';
        document.getElementById('usuarioRol').value = 'docente';
        document.getElementById('usuarioActivo').checked = true;
        passRequerido.classList.remove('hidden');
        passHint.classList.add('hidden');
    }

    onChangeRolUsuario();
    _renderizarCursosUsuario();
    _cargarSelectAlumnosPAT();
    _renderizarAlumnosPATUsuario();

    document.getElementById('modalUsuario').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function cerrarModalUsuario() {
    document.getElementById('modalUsuario').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    _usuarioEdicionId = null;
    _cursosUsuario = [];
    _alumnosPATUsuario = [];
}

function onChangeRolUsuario() {
    const rol = document.getElementById('usuarioRol').value;
    const grupoPAT = document.getElementById('grupoAlumnosPAT');
    if (grupoPAT) grupoPAT.classList.toggle('hidden', rol !== 'pat');
}

function _renderizarCursosUsuario() {
    renderizarChipsCursos('usuarioCursosChips', _cursosUsuario, 'quitarCursoUsuario');
}

window.agregarCursoUsuario = function() {
    const input = document.getElementById('usuarioNuevoCurso');
    const curso = (input.value || '').trim();
    if (!curso) return;
    if (_cursosUsuario.includes(curso)) return mostrarToast('El curso ya está agregado', 'error');
    _cursosUsuario.push(curso);
    _cursosUsuario.sort();
    _renderizarCursosUsuario();
    input.value = '';
};

window.quitarCursoUsuario = function(curso) {
    _cursosUsuario = _cursosUsuario.filter(c => c !== curso);
    _renderizarCursosUsuario();
};

function _renderizarAlumnosPATUsuario() {
    renderizarChipsAlumnosPAT('usuarioAlumnosPATChips', _alumnosPATUsuario, 'quitarAlumnoPATUsuario');
}

function _cargarSelectAlumnosPAT() {
    const select = document.getElementById('usuarioNuevoAlumnoPAT');
    if (!select) return;
    const asignados = new Set(_alumnosPATUsuario);
    const opciones = alumnos
        .filter(a => !asignados.has(a.id))
        .sort((a, b) => `${a.apellido}, ${a.nombre}`.localeCompare(`${b.apellido}, ${b.nombre}`))
        .map(a => `<option value="${a.id}">${a.apellido}, ${a.nombre} · ${a.curso} ${a.division}</option>`)
        .join('');
    select.innerHTML = '<option value="">Seleccionar alumno...</option>' + opciones;
}

window.agregarAlumnoPATUsuario = function() {
    const select = document.getElementById('usuarioNuevoAlumnoPAT');
    const id = select.value;
    if (!id) return;
    if (_alumnosPATUsuario.includes(id)) return;
    _alumnosPATUsuario.push(id);
    _renderizarAlumnosPATUsuario();
    _cargarSelectAlumnosPAT();
    select.value = '';
};

window.quitarAlumnoPATUsuario = function(id) {
    _alumnosPATUsuario = _alumnosPATUsuario.filter(x => x !== id);
    _renderizarAlumnosPATUsuario();
    _cargarSelectAlumnosPAT();
};

async function guardarUsuario() {
    if (!esRegente()) return mostrarToast('Solo el regente puede guardar usuarios', 'error');

    const email = document.getElementById('usuarioEmail').value.trim().toLowerCase();
    const nombre = document.getElementById('usuarioNombre').value.trim();
    const apellido = document.getElementById('usuarioApellido').value.trim();
    const rol = document.getElementById('usuarioRol').value;
    const activo = document.getElementById('usuarioActivo').checked;
    const password = document.getElementById('usuarioPassword').value;

    const esNuevo = !_usuarioEdicionId;

    if (esNuevo && (!email || !nombre || !apellido || !rol)) {
        return mostrarToast('Completá email, nombre, apellido y rol', 'error');
    }

    if (esNuevo && password.length < 6) {
        return mostrarToast('La contraseña debe tener al menos 6 caracteres', 'error');
    }

    mostrarToast('Guardando usuario...', 'info');

    try {
        if (esNuevo) {
            const { data: { session } } = await supabaseClient.auth.getSession();
            const res = await fetch(`${GIE_URL}/functions/v1/crear-usuario`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token || ''}`
                },
                body: JSON.stringify({ email, password, nombre, apellido, rol })
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);

            const nuevoId = json.user?.id;
            if (nuevoId) {
                await supabaseClient.from('perfiles').update({
                    activo,
                    cursos: _cursosUsuario,
                    alumnos_pat: rol === 'pat' ? _alumnosPATUsuario : []
                }).eq('id', nuevoId);
            }
        } else {
            const original = usuarios.find(x => x.id === _usuarioEdicionId);
            if (!original) throw new Error('Usuario no encontrado');

            // Si un input está vacío se conserva el valor original (no se sobreescribe)
            const nombreFinal = nombre || original.nombre;
            const apellidoFinal = apellido || original.apellido;
            const rolFinal = rol || original.rol;
            const cursosFinal = Array.isArray(_cursosUsuario) ? _cursosUsuario : (original.cursos || []);
            const alumnosPATFinal = rolFinal === 'pat'
                ? (Array.isArray(_alumnosPATUsuario) ? _alumnosPATUsuario : (original.alumnos_pat || []))
                : [];

            const updates = {};
            if (nombreFinal !== original.nombre) updates.nombre = nombreFinal;
            if (apellidoFinal !== original.apellido) updates.apellido = apellidoFinal;
            if (rolFinal !== original.rol) updates.rol = rolFinal;
            if (activo !== (original.activo !== false)) updates.activo = activo;

            const cursosOrig = Array.isArray(original.cursos) ? original.cursos : [];
            if (JSON.stringify([...cursosFinal].sort()) !== JSON.stringify([...cursosOrig].sort())) {
                updates.cursos = cursosFinal;
            }

            const alumnosOrig = Array.isArray(original.alumnos_pat) ? original.alumnos_pat : [];
            if (JSON.stringify([...alumnosPATFinal].sort()) !== JSON.stringify([...alumnosOrig].sort())) {
                updates.alumnos_pat = alumnosPATFinal;
            }

            const hayCambiosPerfil = Object.keys(updates).length > 0;
            const hayPasswordNueva = password.length >= 6;

            if (!hayCambiosPerfil && !hayPasswordNueva) {
                cerrarModalUsuario();
                return mostrarToast('No se realizaron cambios', 'info');
            }

            if (hayCambiosPerfil) {
                const { error } = await supabaseClient.from('perfiles').update(updates).eq('id', _usuarioEdicionId);
                if (error) throw new Error(error.message);
            }

            if (hayPasswordNueva) {
                if (!esPasswordValida(password)) {
                    throw new Error('La contraseña es requerida');
                }
                await cambiarPasswordUsuario(_usuarioEdicionId, password);
            }
        }

        await cargarUsuariosSupa();
        filtrarDocentes();
        cerrarModalUsuario();
        mostrarToast('Usuario guardado', 'success');
    } catch (err) {
        mostrarToast(err.message || 'Error guardando usuario', 'error');
    }
}

function esPasswordValida(password) {
    return typeof password === 'string' && password.length >= 1;
}

function abrirModalCambiarPassword(userId) {
    if (!esRegente()) return mostrarToast('Solo el regente puede cambiar contraseñas', 'error');
    document.getElementById('cambiarPasswordUserId').value = userId;
    document.getElementById('cambiarPasswordInput').value = '';
    document.getElementById('cambiarPasswordConfirmar').value = '';
    document.getElementById('modalCambiarPassword').classList.remove('hidden');
}

function cerrarModalCambiarPassword() {
    document.getElementById('modalCambiarPassword').classList.add('hidden');
}

async function confirmarCambiarPassword() {
    const userId = document.getElementById('cambiarPasswordUserId').value;
    const password = document.getElementById('cambiarPasswordInput').value;
    const confirmar = document.getElementById('cambiarPasswordConfirmar').value;

    if (!password || !esPasswordValida(password)) {
        return mostrarToast('La contraseña es requerida', 'error');
    }
    if (password !== confirmar) {
        return mostrarToast('Las contraseñas no coinciden', 'error');
    }

    cerrarModalCambiarPassword();
    await cambiarPasswordUsuario(userId, password);
}

window.cambiarPasswordUsuario = async function(userId, nuevaPassword = null) {
    if (!esRegente()) return mostrarToast('Solo el regente puede cambiar contraseñas', 'error');

    let password = nuevaPassword;
    if (!password) {
        abrirModalCambiarPassword(userId);
        return;
    }

    if (!esPasswordValida(password)) {
        return mostrarToast('La contraseña es requerida', 'error');
    }

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch(`${GIE_URL}/functions/v1/actualizar-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token || ''}`
            },
            body: JSON.stringify({ user_id: userId, new_password: password })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
        if (!nuevaPassword) mostrarToast('Contraseña actualizada', 'success');
    } catch (err) {
        if (!nuevaPassword) mostrarToast(err.message || 'Error cambiando contraseña', 'error');
        throw err;
    }
};

window.cambiarEstadoUsuario = async function(userId, activo) {
    if (!esRegente()) return mostrarToast('Solo el regente puede cambiar el estado', 'error');
    const u = usuarios.find(x => x.id === userId);
    if (!u) return;
    if (u.id === getPerfil()?.id) return mostrarToast('No podés cambiar tu propio estado', 'error');
    if (u.email === 'admin@gie.com') return mostrarToast('No podés desactivar al administrador', 'error');

    const accion = activo ? 'activar' : 'desactivar';
    if (!confirm(`¿${accion.charAt(0).toUpperCase() + accion.slice(1)} el usuario ${u.nombre} ${u.apellido}?`)) return;

    const { error } = await supabaseClient.from('perfiles').update({ activo }).eq('id', userId);
    if (error) return mostrarToast(error.message, 'error');

    // Actualizar estado local inmediatamente para reflejar el cambio en la UI
    const idx = usuarios.findIndex(x => x.id === userId);
    if (idx !== -1) {
        usuarios[idx] = { ...usuarios[idx], activo };
    }

    await cargarUsuariosSupa();
    filtrarDocentes();
    mostrarToast(`Usuario ${activo ? 'activado' : 'desactivado'}`, 'success');
};

function abrirModalConfirmarEliminarUsuario(userId) {
    if (!esRegente()) return mostrarToast('Solo el regente puede eliminar usuarios', 'error');
    const u = usuarios.find(x => x.id === userId);
    if (!u) return;
    if (u.id === getPerfil()?.id) return mostrarToast('No podés eliminar tu propio usuario', 'error');
    if (u.email === 'admin@gie.com') return mostrarToast('No podés eliminar al administrador', 'error');

    document.getElementById('eliminarUsuarioId').value = userId;
    document.getElementById('textoConfirmarEliminarUsuario').textContent =
        `${escapeHtml(u.apellido || '')}, ${escapeHtml(u.nombre || '')} (${escapeHtml(u.email)})`;
    document.getElementById('modalConfirmarEliminarUsuario').classList.remove('hidden');
}

function cerrarModalConfirmarEliminarUsuario() {
    document.getElementById('modalConfirmarEliminarUsuario').classList.add('hidden');
    document.getElementById('eliminarUsuarioId').value = '';
}

async function confirmarEliminarUsuario() {
    const userId = document.getElementById('eliminarUsuarioId').value;
    if (!userId) return;

    cerrarModalConfirmarEliminarUsuario();

    const filaDesktop = document.getElementById(`fila-usuario-${userId}`);
    const tarjetaMobile = document.getElementById(`tarjeta-usuario-${userId}`);

    try {
        const { error } = await supabaseClient.rpc('eliminar_usuario_completo', { user_id: userId });
        if (error) throw new Error(error.message);

        // Animar y remover de la UI sin recargar toda la lista
        if (filaDesktop) filaDesktop.classList.add('animate-slide-out');
        if (tarjetaMobile) tarjetaMobile.classList.add('animate-slide-out');

        await new Promise(r => setTimeout(r, 400));

        if (filaDesktop) filaDesktop.remove();
        if (tarjetaMobile) tarjetaMobile.remove();

        // Actualizar arrays locales
        usuarios = usuarios.filter(u => u.id !== userId);
        filtrarDocentes();

        mostrarToast('Usuario eliminado', 'success');
    } catch (err) {
        if (filaDesktop) filaDesktop.classList.remove('animate-slide-out');
        if (tarjetaMobile) tarjetaMobile.classList.remove('animate-slide-out');
        mostrarToast(err.message || 'Error eliminando usuario', 'error');
    }
}

window.eliminarUsuario = abrirModalConfirmarEliminarUsuario;

window.agregarMiCurso = async function() {
    const anio = document.getElementById('ajustesCursoAnio').value;
    const div = document.getElementById('ajustesCursoDivision').value;
    if (!anio || !div) return mostrarToast('Seleccioná año y división', 'error');
    const curso = `${anio}${div}`;
    if (_cursosAjustes.includes(curso)) return mostrarToast('El curso ya está agregado', 'error');
    const previo = [..._cursosAjustes];
    _cursosAjustes.push(curso);
    _cursosAjustes.sort();
    renderizarChipsCursos('ajustesCursosLista', _cursosAjustes, 'quitarMiCurso');
    document.getElementById('ajustesCursoAnio').value = '';
    document.getElementById('ajustesCursoDivision').value = '';
    const ok = await _persistirMisCursos();
    if (!ok) {
        _cursosAjustes = previo;
        renderizarChipsCursos('ajustesCursosLista', _cursosAjustes, 'quitarMiCurso');
    }
};

window.quitarMiCurso = async function(curso) {
    const previo = [..._cursosAjustes];
    _cursosAjustes = _cursosAjustes.filter(c => c !== curso);
    renderizarChipsCursos('ajustesCursosLista', _cursosAjustes, 'quitarMiCurso');
    const ok = await _persistirMisCursos();
    if (!ok) {
        _cursosAjustes = previo;
        renderizarChipsCursos('ajustesCursosLista', _cursosAjustes, 'quitarMiCurso');
    }
};

// ==================== PAT - ALUMNOS ====================
async function _persistirMisAlumnosPAT() {
    const raw = getPerfil()?.alumnos_pat;
    const alumnoIds = _normalizarArrayUUIDs(raw);
    const id = getPerfil()?.id;
    if (!id) {
        return false;
    }
    try {
        const { error } = await supabaseClient.from('perfiles').update({ alumnos_pat: alumnoIds }).eq('id', id);
        if (error) {
            mostrarToast('Error guardando alumnos PAT: ' + error.message, 'error');
            return false;
        }
        return true;
    } catch (err) {
        mostrarToast('Error inesperado guardando alumnos PAT', 'error');
        return false;
    }
}

window.buscarAlumnoPAT = function(query) {
    _buscarAlumnoGenerico(query, 'resultadosAlumnoPAT', 'seleccionarAlumnoPAT');
};

window.seleccionarAlumnoPAT = async function(id, nombre, apellido) {
    document.getElementById('resultadosAlumnoPAT').classList.add('hidden');
    document.getElementById('inputBuscarAlumnoPAT').value = '';
    const perfil = getPerfil();
    if (!perfil) return;
    const previo = _normalizarArrayUUIDs(perfil.alumnos_pat);
    const idStr = String(id).trim();
    if (previo.includes(idStr)) return mostrarToast('El alumno ya está agregado', 'error');
    const nuevos = [...previo, idStr];

    setPerfil({ ...perfil, alumnos_pat: nuevos });
    renderizarChipsAlumnosPAT('ajustesAlumnosPATLista', nuevos, 'quitarAlumnoPAT');
    const ok = await _persistirMisAlumnosPAT();
    if (!ok) {
        setPerfil({ ...perfil, alumnos_pat: previo });
        renderizarChipsAlumnosPAT('ajustesAlumnosPATLista', previo, 'quitarAlumnoPAT');
    }
};

window.quitarAlumnoPAT = async function(id) {
    const perfil = getPerfil();
    if (!perfil) return;
    const previo = _normalizarArrayUUIDs(perfil.alumnos_pat);
    const idStr = String(id).trim();
    const nuevos = previo.filter(x => x !== idStr);
    setPerfil({ ...perfil, alumnos_pat: nuevos });
    renderizarChipsAlumnosPAT('ajustesAlumnosPATLista', nuevos, 'quitarAlumnoPAT');
    const ok = await _persistirMisAlumnosPAT();
    if (!ok) {
        setPerfil({ ...perfil, alumnos_pat: previo });
        renderizarChipsAlumnosPAT('ajustesAlumnosPATLista', previo, 'quitarAlumnoPAT');
    }
};

async function _persistirMisCursos() {
    const cursos = [..._cursosAjustes];
    const id = getPerfil()?.id;
    if (!id) return false;
    const { error } = await supabaseClient.from('perfiles').update({ cursos }).eq('id', id);
    if (error) {
        mostrarToast('Error guardando cursos', 'error');
        return false;
    }
    setPerfilCursos(cursos);
    return true;
}

// ==================== PLANTILLAS CRUD ====================
async function cargarPlantillas() {
    if (!USE_SUPABASE) return;
    const { data, error } = await supabaseClient.from('plantillas').select('*').eq('activo', true).order('created_at', { ascending: false });
    if (error) { return; }
    plantillas = data || [];
    // Plantillas cargadas
    renderizarSelectPlantillas();
}

function calcularTendenciaPlantillas() {
    const hace30Dias = new Date();
    hace30Dias.setDate(hace30Dias.getDate() - 30);
    const frecuencia = {};

    // Contar informes recientes por título
    informes.forEach(i => {
        const fecha = new Date(i.fecha_creacion);
        if (fecha >= hace30Dias) {
            frecuencia[i.titulo] = (frecuencia[i.titulo] || 0) + 1;
        }
    });

    return frecuencia;
}

function renderizarSelectPlantillas() {
    const select = document.getElementById('plantillaInforme');
    if (!select) return;

    const predefinidas = Object.entries(PLANTILLAS_INFORME).map(([key, p]) => ({
        key, titulo: p.titulo, instancia: p.instancia, resumen: p.resumen
    })).sort((a, b) => a.titulo.localeCompare(b.titulo));

    const personalizadas = plantillas.slice().sort((a, b) => a.titulo.localeCompare(b.titulo));

    let html = '<option value="">Seleccionar plantilla...</option>';

    if (predefinidas.length > 0) {
        html += '<optgroup label="Predefinidas">';
        predefinidas.forEach(p => {
            html += `<option value="${p.key}" data-predefinida="true">${p.titulo}</option>`;
        });
        html += '</optgroup>';
    }

    if (personalizadas.length > 0) {
        html += '<optgroup label="Personalizadas">';
        personalizadas.forEach(p => {
            html += `<option value="${p.id}" data-predefinida="false">${p.titulo}</option>`;
        });
        html += '</optgroup>';
    }

    select.innerHTML = html;
}

function renderizarSelectCategorias() {
    const select = document.getElementById('categoriaInforme');
    if (!select) return;
    const actual = select.value;
    let html = '<option value="">Seleccione...</option>';
    categorias.forEach(c => {
        html += `<option value="${c.id}">${c.nombre}</option>`;
    });
    select.innerHTML = html;
    if (actual) {
        select.value = actual;
    } else {
        const otros = categorias.find(c => c.nombre.toLowerCase() === 'otros');
        if (otros) select.value = otros.id;
    }
}

window.abrirModalCategorias = function() {
    document.getElementById('modalCategorias').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    renderizarListaCategorias();
};
window.cerrarModalCategorias = function() {
    document.getElementById('modalCategorias').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
};

function renderizarListaCategorias() {
    const container = document.getElementById('listaCategorias');
    if (!container) return;
    if (categorias.length === 0) {
        container.innerHTML = '<p class="text-sm text-slate-400 italic">No hay categorías.</p>';
        return;
    }
    const puedeEliminar = esRegente() || getPerfil()?.email === 'admin@gie.com';
    const sorted = categorias.slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
    container.innerHTML = sorted.map(c => `
        <div id="cat-card-${c.id}" class="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200 hover:border-slate-300 transition-colors">
            <div class="min-w-0 flex items-center gap-3">
                <span class="inline-block w-4 h-4 rounded-full border border-slate-200" style="background-color:${c.color || '#3b82f6'}"></span>
                <p class="text-sm font-medium text-slate-700 truncate">${c.nombre}</p>
            </div>
            ${puedeEliminar ? `<button onclick="eliminarCategoria('${c.id}')" class="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 text-xs font-medium rounded-md transition-colors border border-red-200" title="Eliminar categoría">
                <i class="mdi mdi-delete-outline"></i> Eliminar
            </button>` : ''}
        </div>
    `).join('');
}

window.crearCategoria = async function() {
    const nombre = document.getElementById('newCategoriaNombre').value.trim();
    const color = document.getElementById('newCategoriaColor').value;
    if (!nombre) return mostrarToast('Ingresa un nombre para la categoría', 'error');
    if (nombre.length > 100) return mostrarToast('El nombre no puede exceder 100 caracteres', 'error');
    if (categorias.some(c => c.nombre.toLowerCase() === nombre.toLowerCase())) {
        return mostrarToast('Ya existe una categoría con ese nombre', 'error');
    }
    if (USE_SUPABASE) {
        const { error } = await supabaseClient.from('categorias').insert({
            nombre, color, activo: true
        });
        if (error) { return mostrarToast('Error creando categoría', 'error'); }
    } else {
        return mostrarToast('Servicio de autenticación no disponible', 'error');
    }
    mostrarToast('Categoría creada');
    document.getElementById('newCategoriaNombre').value = '';
    document.getElementById('newCategoriaColor').value = '#3b82f6';
    await cargarCategorias();
    renderizarListaCategorias();
};

window.eliminarCategoria = async function(id) {
    const c = categorias.find(x => x.id === id);
    if (!c) return;
    const puedeEliminar = esRegente() || getPerfil()?.email === 'admin@gie.com';
    if (!puedeEliminar) {
        return mostrarToast('No tiene permiso para eliminar categorías', 'error');
    }
    const enUso = informes.some(i => i.categoria_id === id);
    if (enUso) {
        return mostrarToast(`No se puede eliminar la categoría "${c.nombre}" porque tiene informes asociados`, 'error');
    }
    if (!confirm(`¿Eliminar la categoría "${c.nombre}"?`)) return;
    const el = document.getElementById(`cat-card-${id}`);
    if (el) el.classList.add('animate-slide-out');
    await new Promise(r => setTimeout(r, 400));
    const { error } = await supabaseClient.from('categorias').delete().eq('id', id);
    if (error) {
        if (el) el.classList.remove('animate-slide-out');
        return mostrarToast('Error eliminando categoría', 'error');
    }
    // Recargar desde el servidor para confirmar que realmente se eliminó
    await cargarCategorias();
    const sigueExistente = categorias.some(x => x.id === id);
    if (sigueExistente) {
        if (el) el.classList.remove('animate-slide-out');
        return mostrarToast('No se pudo eliminar la categoría. Verifique que tenga permisos.', 'error');
    }
    mostrarToast('Categoría eliminada');
    renderizarListaCategorias();
};

window.abrirModalPlantillas = function() {
    document.getElementById('modalPlantillas').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    renderizarListaPlantillas();
};
window.cerrarModalPlantillas = function() {
    document.getElementById('modalPlantillas').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
};

function renderizarListaPlantillas() {
    const container = document.getElementById('listaPlantillas');
    if (!container) return;

    // Predefinidas (solo lectura)
    let html = '<div class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Predefinidas</div>';
    Object.entries(PLANTILLAS_INFORME).forEach(([key, p]) => {
        html += `
        <div class="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-100">
            <div class="min-w-0">
                <p class="text-sm font-medium text-slate-700 truncate">${p.titulo}</p>
                <p class="text-xs text-slate-500 capitalize">${p.instancia}</p>
            </div>
            <span class="text-xs text-slate-400">Sistema</span>
        </div>`;
    });

    // Personalizadas
    if (plantillas.length > 0) {
        html += '<div class="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-3 mb-1">Personalizadas</div>';
        plantillas.filter(p => p.activo !== false).forEach(p => {
            html += `
            <div class="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200 hover:border-slate-300 transition-colors">
                <div class="min-w-0">
                    <p class="text-sm font-medium text-slate-700 truncate">${p.titulo}</p>
                    <p class="text-xs text-slate-500 capitalize">${p.instancia}</p>
                </div>
                <button onclick="eliminarPlantilla('${p.id}')" class="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 text-xs font-medium rounded-md transition-colors border border-red-200" title="Eliminar plantilla">
                    <i class="mdi mdi-delete-outline"></i> Eliminar
                </button>
            </div>`;
        });
    } else {
        html += '<p class="text-sm text-slate-400 italic mt-2">No hay plantillas personalizadas.</p>';
    }

    container.innerHTML = html;
}

window.crearPlantilla = async function() {
    const titulo = document.getElementById('newPlantillaTitulo').value.trim();
    const instancia = document.getElementById('newPlantillaInstancia').value;
    const resumen = document.getElementById('newPlantillaResumen').value.trim();

    if (!titulo || !instancia || !resumen) {
        return mostrarToast('Completa todos los campos', 'error');
    }
    if (titulo.length > 200) return mostrarToast('El título no puede exceder 200 caracteres', 'error');
    if (resumen.length > 2000) return mostrarToast('El resumen no puede exceder 2000 caracteres', 'error');

    if (USE_SUPABASE) {
        mostrarToast('Creando plantilla...', 'info');
        const { data, error } = await supabaseClient.from('plantillas').insert({
            titulo, instancia, resumen, creado_por: getPerfil().id, usos: 0, activo: true
        }).select().single();
        if (error) { return mostrarToast('Error creando plantilla', 'error'); }
        // Plantilla creada
    } else {
        return mostrarToast('Servicio de autenticación no disponible', 'error');
    }

    mostrarToast('Plantilla creada');
    document.getElementById('newPlantillaTitulo').value = '';
    document.getElementById('newPlantillaInstancia').value = '';
    document.getElementById('newPlantillaResumen').value = '';
    await cargarPlantillas();
    renderizarListaPlantillas();
};

window.eliminarPlantilla = async function(id) {
    const p = plantillas.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`¿Eliminar la plantilla "${p.titulo}"?`)) return;

    mostrarToast('Eliminando plantilla...', 'info');
    const { error } = await supabaseClient.from('plantillas').delete().eq('id', id);
    if (error) { return mostrarToast('Error eliminando plantilla', 'error'); }

    mostrarToast('Plantilla eliminada');
    await cargarPlantillas();
    renderizarListaPlantillas();
};

// ==================== EXPORTAR PDF ====================
async function exportarPDF(id) {
    if (_generandoPDF) return;
    if (typeof html2pdf !== 'function') return mostrarToast('Error: librería PDF no disponible', 'error');
    _generandoPDF = true;
    mostrarToast('Generando PDF...');
    const informe = getInforme(id);
    if (!informe) { _generandoPDF = false; return; }
    const alumno = getAlumno(informe.alumno_id);
    const creador = escapeHtml(getNombreUsuario(informe.creado_por));
    const chk = (val) => informe.instancia === val ? '☑' : '☐';

    // Cargar logo como base64
    let logoSrc = '';
    try {
        const res = await fetch('./logo-informe.png');
        const blob = await res.blob();
        logoSrc = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch (e) { /* sin logo */ }

    const scrollY = window.scrollY;
    window.scrollTo(0, 0);
    const container = document.createElement('div');
    container.style.cssText = 'padding:12px 24px; font-family:Arial,Helvetica,sans-serif; color:#000; max-width:800px; margin:0 auto; background:#fff; font-size:11px; line-height:1.4;';
    container.innerHTML = `
        <div style="text-align:center; margin-bottom:10px;">
            ${logoSrc ? `<img src="${logoSrc}" style="height:50px; margin:0 auto 4px; display:block;" />` : ''}
            <div style="font-size:10px; font-weight:bold;">GOBIERNO DE LA CIUDAD AUTÓNOMA DE BUENOS AIRES</div>
            <div style="font-size:10px; font-weight:bold;">MINISTERIO DE EDUCACIÓN</div>
            <div style="font-size:10px; font-weight:bold; margin-top:2px;">E.T. N°35 D.E. 18, "Ing. Eduardo Latzina"</div>
            <div style="font-size:12px; font-weight:bold; margin-top:4px; text-decoration:underline;">INFORME DE CONVIVENCIA ESCOLAR</div>
            ${informe.numero !== null && informe.numero !== undefined ? `<div style="font-size:11px; font-weight:bold; margin-top:2px;">Informe N° ${escapeHtml(informe.numero)}</div>` : `<div style="font-size:11px; color:#ef4444; margin-top:2px;">Sin numerar</div>`}
        </div>

        <div style="margin-bottom:6px;">
            <div style="font-weight:bold; font-size:10px; margin-bottom:2px;">1. Datos del Alumno/a</div>
            <table style="width:100%; border-collapse:collapse;">
                <tr><td style="padding:2px 0 10px 0; width:80px;">Alumno/a:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;">${alumno ? `${escapeHtml(alumno.apellido)}, ${escapeHtml(alumno.nombre)}` : ''}</td></tr>
                <tr><td style="padding:2px 0 10px 0;">Año:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;">${alumno ? escapeHtml(alumno.curso) : ''}</td></tr>
                <tr><td style="padding:2px 0 10px 0;">División:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;">${alumno ? escapeHtml(alumno.division) : ''}</td></tr>
                ${alumno?.turno ? `<tr><td style="padding:2px 0 10px 0;">Turno:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;">${escapeHtml(alumno.turno)}</td></tr>` : ''}
                ${alumno?.especialidad && alumno.especialidad !== 'Sin especialidad' ? `<tr><td style="padding:2px 0 10px 0;">Especialidad:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;">${escapeHtml(alumno.especialidad)}</td></tr>` : ''}
            </table>
        </div>

        <div style="margin-bottom:6px;">
            <div style="font-weight:bold; font-size:10px; margin-bottom:2px;">2. Descripción de la Acción</div>
            <p style="margin:0 0 4px;">Ha realizado la acción que se describe a continuación:</p>
            <div style="border:1px solid #000; padding:6px; min-height:100px; margin-bottom:4px;">
                <div style="font-weight:bold; margin-bottom:2px;">${escapeHtml(informe.titulo)}</div>
                <div style="white-space:pre-wrap;">${escapeHtml(informe.resumen)}</div>
            </div>
            <p style="margin:0;">transgrediendo normas del reglamento y convivencia de la escuela.</p>
        </div>

        <div style="margin-bottom:6px;">
            <div style="font-weight:bold; font-size:10px; margin-bottom:2px;">3. Solicitud de Sanción</div>
            <table style="width:100%; border-collapse:collapse;">
                <tr><td style="padding:2px 0 10px 0; width:100px;">Docente:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;">${creador}</td></tr>
                <tr><td style="padding:2px 0 10px 0;">Cargo / Función:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;">Docente</td></tr>
                <tr><td style="padding:2px 0 10px 0;">Fecha:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;">${formatearFecha(informe.fecha_creacion)}</td></tr>
                <tr><td style="padding:2px 0 10px 0;">Firma:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;"></td></tr>
            </table>
        </div>

        <div style="margin-bottom:6px;">
            <div style="font-weight:bold; font-size:10px; margin-bottom:2px;">4. Descargo del Alumno/a</div>
            <div style="border:1px solid #000; padding:6px; min-height:80px;">${informe.descargo ? `<div style="white-space:pre-wrap;">${escapeHtml(informe.descargo)}</div>` : ''}</div>
        </div>

        <div style="margin-bottom:6px;">
            <div style="font-weight:bold; font-size:10px; margin-bottom:2px;">5. Observaciones</div>
            <div style="border:1px solid #000; padding:6px; min-height:80px;">${informe.observaciones ? `<div style="white-space:pre-wrap;">${escapeHtml(informe.observaciones)}</div>` : ''}</div>
        </div>

        <div>
            <div style="font-weight:bold; font-size:10px; margin-bottom:2px;">6. Determinación de la Sanción</div>
            <p style="margin:0 0 4px;">Se considera que corresponde:</p>
            <div style="display:flex; gap:16px; flex-wrap:wrap;">
                <span>${chk('leve')}&nbsp;&nbsp;1° Instancia — LEVE</span>
                <span>${chk('grave')}&nbsp;&nbsp;2° Instancia — GRAVE</span>
                <span>${chk('muy_grave')}&nbsp;&nbsp;3° Instancia — MUY GRAVE</span>
                <span>${chk('consejo_aula')}&nbsp;&nbsp;4° Instancia — CONSEJO DE AULA</span>
                <span>${chk('consejo')}&nbsp;&nbsp;5° Instancia — CONSEJO ESCOLAR</span>
            </div>
            <div style="margin-top:4px;">
                <div style="margin-bottom:6px;">Otra consideración:</div>
                <div style="border-bottom:1px solid #000; height:24px;"></div>
            </div>
            <div style="margin-top:8px;">
                <table style="width:100%; border-collapse:collapse;">
                    <tr><td style="padding:2px 0 10px 0; width:50%;">Firma del Directivo:</td><td style="padding:2px 0 10px 0;">Fecha:</td></tr>
                    <tr><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;"></td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;">${formatearFecha(new Date().toISOString())}</td></tr>
                </table>
            </div>
        </div>
    `;
    document.body.appendChild(container);
    try {
        await html2pdf().set({ margin: [8,8,8,8], filename: `informe_${alumno ? alumno.apellido : 'doc'}_${informe.fecha_creacion.split('T')[0]}.pdf`, html2canvas: { scale: 2, scrollY: 0 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(container).save();
    } catch (e) {
        mostrarToast('Error generando PDF', 'error');
    }
    document.body.removeChild(container);
    window.scrollTo(0, scrollY);
    _generandoPDF = false;
}

async function exportarPDFEnBlanco() {
    if (_generandoPDF) return;
    if (typeof html2pdf !== 'function') return mostrarToast('Error: librería PDF no disponible', 'error');
    _generandoPDF = true;
    mostrarToast('Generando PDF...');
    // Cargar logo como base64
    let logoSrc = '';
    try {
        const res = await fetch('./logo-informe.png');
        const blob = await res.blob();
        logoSrc = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch (e) { /* sin logo */ }

    const scrollY = window.scrollY;
    window.scrollTo(0, 0);
    const container = document.createElement('div');
    container.style.cssText = 'padding:12px 24px; font-family:Arial,Helvetica,sans-serif; color:#000; max-width:800px; margin:0 auto; background:#fff; font-size:11px; line-height:1.4;';
    container.innerHTML = `
        <div style="text-align:center; margin-bottom:10px;">
            ${logoSrc ? `<img src="${logoSrc}" style="height:50px; margin:0 auto 4px; display:block;" />` : ''}
            <div style="font-size:10px; font-weight:bold;">GOBIERNO DE LA CIUDAD AUTÓNOMA DE BUENOS AIRES</div>
            <div style="font-size:10px; font-weight:bold;">MINISTERIO DE EDUCACIÓN</div>
            <div style="font-size:10px; font-weight:bold; margin-top:2px;">E.T. N°35 D.E. 18, "Ing. Eduardo Latzina"</div>
            <div style="font-size:12px; font-weight:bold; margin-top:4px; text-decoration:underline;">INFORME DE CONVIVENCIA ESCOLAR</div>
        </div>

        <div style="margin-bottom:6px;">
            <div style="font-weight:bold; font-size:10px; margin-bottom:2px;">1. Datos del Alumno/a</div>
            <table style="width:100%; border-collapse:collapse;">
                <tr><td style="padding:2px 0 10px 0; width:80px;">Alumno/a:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;"></td></tr>
                <tr><td style="padding:2px 0 10px 0;">Año:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;"></td></tr>
                <tr><td style="padding:2px 0 10px 0;">División:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;"></td></tr>
                <tr><td style="padding:2px 0 10px 0;">Turno:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;"></td></tr>
            </table>
        </div>

        <div style="margin-bottom:6px;">
            <div style="font-weight:bold; font-size:10px; margin-bottom:2px;">2. Descripción de la Acción</div>
            <p style="margin:0 0 4px;">Ha realizado la acción que se describe a continuación:</p>
            <div style="border:1px solid #000; padding:6px; min-height:100px; margin-bottom:4px;">
                <div style="font-weight:bold; margin-bottom:2px;"></div>
                <div></div>
            </div>
            <p style="margin:0;">transgrediendo normas del reglamento y convivencia de la escuela.</p>
        </div>

        <div style="margin-bottom:6px;">
            <div style="font-weight:bold; font-size:10px; margin-bottom:2px;">3. Solicitud de Sanción</div>
            <table style="width:100%; border-collapse:collapse;">
                <tr><td style="padding:2px 0 10px 0; width:100px;">Docente:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;"></td></tr>
                <tr><td style="padding:2px 0 10px 0;">Cargo / Función:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;"></td></tr>
                <tr><td style="padding:2px 0 10px 0;">Fecha:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;"></td></tr>
                <tr><td style="padding:2px 0 10px 0;">Firma:</td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;"></td></tr>
            </table>
        </div>

        <div style="margin-bottom:6px;">
            <div style="font-weight:bold; font-size:10px; margin-bottom:2px;">4. Descargo del Alumno/a</div>
            <div style="border:1px solid #000; padding:6px; min-height:80px;"></div>
        </div>

        <div style="margin-bottom:6px;">
            <div style="font-weight:bold; font-size:10px; margin-bottom:2px;">5. Observaciones</div>
            <div style="border:1px solid #000; padding:6px; min-height:80px;"></div>
        </div>

        <div>
            <div style="font-weight:bold; font-size:10px; margin-bottom:2px;">6. Determinación de la Sanción</div>
            <p style="margin:0 0 4px;">Se considera que corresponde:</p>
            <div style="display:flex; gap:16px; flex-wrap:wrap;">
                <span>☐&nbsp;&nbsp;1° Instancia — LEVE</span>
                <span>☐&nbsp;&nbsp;2° Instancia — GRAVE</span>
                <span>☐&nbsp;&nbsp;3° Instancia — MUY GRAVE</span>
                <span>☐&nbsp;&nbsp;4° Instancia — CONSEJO DE AULA</span>
                <span>☐&nbsp;&nbsp;5° Instancia — CONSEJO ESCOLAR</span>
            </div>
            <div style="margin-top:4px;">
                <div style="margin-bottom:6px;">Otra consideración:</div>
                <div style="border-bottom:1px solid #000; height:24px;"></div>
            </div>
            <div style="margin-top:8px;">
                <table style="width:100%; border-collapse:collapse;">
                    <tr><td style="padding:2px 0 10px 0; width:50%;">Firma del Directivo:</td><td style="padding:2px 0 10px 0;">Fecha:</td></tr>
                    <tr><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;"></td><td style="padding:2px 0 10px 0; border-bottom:1px solid #000;"></td></tr>
                </table>
            </div>
        </div>
    `;
    document.body.appendChild(container);
    try {
        await html2pdf().set({ margin: [8,8,8,8], filename: `informe_en_blanco_${new Date().toISOString().split('T')[0]}.pdf`, html2canvas: { scale: 2, scrollY: 0 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(container).save();
    } catch (e) {
        mostrarToast('Error generando PDF', 'error');
    }
    document.body.removeChild(container);
    window.scrollTo(0, scrollY);
    _generandoPDF = false;
}

function mostrarDrillDownAnio(anio, data) {
    const container = document.getElementById('drillDownAnio');
    const titulo = document.getElementById('drillDownTitulo');
    const contenido = document.getElementById('drillDownContenido');
    if (!container || !data) return;

    titulo.textContent = `Desglose ${anio}`;
    const items = Object.entries(data).sort((a, b) => a[0].localeCompare(b[0]));
    contenido.innerHTML = items.map(([cursoDiv, cantidad]) => `
        <div class="flex items-center justify-between py-1.5 px-3 bg-slate-50 rounded-lg">
            <span class="text-sm font-medium text-slate-700">${cursoDiv}</span>
            <span class="text-sm font-bold text-blue-600">${cantidad}</span>
        </div>
    `).join('');
    container.classList.remove('hidden');
}

window.cerrarDrillDownAnio = function() {
    const container = document.getElementById('drillDownAnio');
    if (container) container.classList.add('hidden');
};
window.cambiarPeriodoTendencia = cambiarPeriodoTendencia;

// ==================== ESPACIO BASE DE DATOS ====================
const DB_LIMITE_MB_DEFAULT = 500; // Límite por defecto (plan Free Supabase)

async function cargarEspacioBD() {
    if (!USE_SUPABASE) return;
    const esRegente = getPerfil()?.rol === 'regente';
    const card = document.getElementById('cardDbSpace');
    if (!esRegente) {
        if (card) card.classList.add('hidden');
        return;
    }
    if (card) card.classList.remove('hidden');

    const { data, error } = await supabaseClient.rpc('obtener_espacio_bd');
    if (error || !data || !data.length) {
        document.getElementById('dbSpaceUsedLabel').textContent = 'Error';
        return;
    }
    const row = data[0];
    renderizarEspacioBD(row.usado_bytes, row.usado_texto);
}

function renderizarEspacioBD(usadoBytes, usadoTexto) {
    const usedLabel = document.getElementById('dbSpaceUsedLabel');
    const totalLabel = document.getElementById('dbSpaceTotalLabel');
    const percentLabel = document.getElementById('dbSpacePercentLabel');
    const bar = document.getElementById('dbSpaceBar');
    const alertEl = document.getElementById('dbSpaceAlert');

    const limiteMB = parseInt(localStorage.getItem('gie_db_limite_mb') || DB_LIMITE_MB_DEFAULT, 10);
    const limiteBytes = limiteMB * 1024 * 1024;
    let porcentaje = usadoBytes ? Math.round((usadoBytes / limiteBytes) * 100) : 0;
    if (porcentaje > 100) porcentaje = 100;

    usedLabel.textContent = usadoTexto || '—';
    totalLabel.textContent = formatearBytes(limiteBytes);
    percentLabel.textContent = porcentaje + '%';
    bar.style.width = porcentaje + '%';

    bar.classList.remove('bg-blue-500', 'bg-amber-500', 'bg-red-500');
    alertEl.classList.add('hidden');
    if (porcentaje >= 90) {
        bar.classList.add('bg-red-500');
        alertEl.classList.remove('hidden');
    } else if (porcentaje >= 70) {
        bar.classList.add('bg-amber-500');
    } else {
        bar.classList.add('bg-blue-500');
    }
}

function formatearBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
    return Number.isInteger(val) ? val + ' ' + sizes[i] : val + ' ' + sizes[i];
}

// Exponer funciones usadas en onclick al scope global
window.showSection = showSection;
window.logout = logout;

// Debug helper: ejecutar debugGIE() en la consola del navegador
window.debugGIE = function() {
    // Debug helper desactivado en producción
};

window.verDetalle = verDetalle;
window.verAlumno = verAlumno;
window.verDocente = verDocente;
window.editarInforme = editarInforme;
window.cambiarEstado = cambiarEstado;
window.cerrarModal = cerrarModal;
window.cerrarModalGrupo = cerrarModalGrupo;
window.abrirModalGrupoInformes = abrirModalGrupoInformes;
window.exportarPDF = exportarPDF;
window.exportarPDFEnBlanco = exportarPDFEnBlanco;
window.limpiarAlumno = limpiarAlumno;
window.cancelarForm = cancelarForm;
window.filtrarInformes = filtrarInformes;
window.seleccionarAlumno = seleccionarAlumno;
window.abrirModalPlantillas = abrirModalPlantillas;
window.cerrarModalPlantillas = cerrarModalPlantillas;
window.crearPlantilla = crearPlantilla;
window.eliminarPlantilla = eliminarPlantilla;
window.abrirModalCategorias = abrirModalCategorias;
window.cerrarModalCategorias = cerrarModalCategorias;
window.crearCategoria = crearCategoria;
window.eliminarCategoria = eliminarCategoria;
window.mostrarDerivacion = mostrarDerivacion;
window.cerrarModalDerivacion = cerrarModalDerivacion;
window.confirmarDerivacion = confirmarDerivacion;
window.toggleFormObservacion = toggleFormObservacion;
window.guardarObservacionAlumno = guardarObservacionAlumno;
window.eliminarObservacionAlumno = eliminarObservacionAlumno;
window.onChangeObsTipo = onChangeObsTipo;
window.abrirModalTiposObservacion = abrirModalTiposObservacion;
window.cerrarModalTiposObservacion = cerrarModalTiposObservacion;
window.crearTipoObservacion = crearTipoObservacion;
window.eliminarTipoObservacion = eliminarTipoObservacion;

// ==================== ALUMNOS (solo lectura desde Nexus) ====================

// ==================== FECHA DE REUNIÓN ====================
let _reunionCallback = null;
window.mostrarModalFechaReunion = function(informeId, callback) {
    _reunionCallback = callback;
    document.getElementById('reunionInformeId').value = informeId;
    document.getElementById('fechaReunionInput').value = '';
    document.getElementById('reunionObservacion').value = '';
    document.getElementById('modalFechaReunion').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
};
window.cerrarModalFechaReunion = function() {
    document.getElementById('modalFechaReunion').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    _reunionCallback = null;
};
window.confirmarFechaReunion = async function(omitir) {
    const informeId = document.getElementById('reunionInformeId').value;
    let fechaReunion = null;
    if (!omitir) {
        fechaReunion = document.getElementById('fechaReunionInput').value || null;
    }
    document.getElementById('modalFechaReunion').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    if (_reunionCallback) {
        await _reunionCallback(informeId, fechaReunion);
        _reunionCallback = null;
    }
};

// ==================== GESTIÓN DE REUNIONES ====================
window.mostrarModalGestionReunion = function(informeId, fechaActual) {
    document.getElementById('gestionReunionInformeId').value = informeId;
    document.getElementById('gestionReunionFecha').value = fechaActual || '';
    document.getElementById('modalGestionReunion').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
};
window.cerrarModalGestionReunion = function() {
    document.getElementById('modalGestionReunion').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
};
window.guardarCambioReunion = async function() {
    const id = document.getElementById('gestionReunionInformeId').value;
    const fecha = document.getElementById('gestionReunionFecha').value || null;
    mostrarToast('Actualizando reunión...', 'info');
    const { error } = await supabaseClient.from('informes').update({ fecha_reunion: fecha }).eq('id', id);
    if (error) return mostrarToast('Error actualizando reunión', 'error');
    await registrarHistorial(id, 'reunion', `Fecha de reunión actualizada por ${getNombreUsuario(getPerfil().id)}`);
    await cargarInformes();
    actualizarDashboard();
    cerrarModalGestionReunion();
    mostrarToast('Reunión actualizada');
};
window.posponerReunion = async function(dias) {
    const id = document.getElementById('gestionReunionInformeId').value;
    const fechaActual = document.getElementById('gestionReunionFecha').value;
    const fecha = new Date(fechaActual || new Date());
    fecha.setDate(fecha.getDate() + dias);
    const fechaStr = fecha.toISOString().split('T')[0];
    mostrarToast('Posponiendo reunión...', 'info');
    const { error } = await supabaseClient.from('informes').update({ fecha_reunion: fechaStr }).eq('id', id);
    if (error) return mostrarToast('Error posponiendo reunión', 'error');
    await registrarHistorial(id, 'reunion_pospuesta', `Reunión pospuesta ${dias} días por ${getNombreUsuario(getPerfil().id)}`);
    await cargarInformes();
    actualizarDashboard();
    cerrarModalGestionReunion();
    mostrarToast(`Reunión pospuesta ${dias} días`);
};
window.eliminarReunion = async function() {
    const id = document.getElementById('gestionReunionInformeId').value;
    if (!confirm('¿Eliminar la fecha de reunión?')) return;
    mostrarToast('Eliminando reunión...', 'info');
    const { error } = await supabaseClient.from('informes').update({ fecha_reunion: null }).eq('id', id);
    if (error) return mostrarToast('Error eliminando reunión', 'error');
    await registrarHistorial(id, 'reunion_eliminada', `Fecha de reunión eliminada por ${getNombreUsuario(getPerfil().id)}`);
    await cargarInformes();
    actualizarDashboard();
    cerrarModalGestionReunion();
    mostrarToast('Reunión eliminada');
};

window.mostrarToast = mostrarToast;

// ==================== GESTIÓN DE USUARIOS (window) ====================
window.cargarUsuarios = cargarUsuarios;
window.abrirModalUsuario = abrirModalUsuario;
window.cerrarModalUsuario = cerrarModalUsuario;
window.guardarUsuario = guardarUsuario;
window.onChangeRolUsuario = onChangeRolUsuario;
window.quitarCursoUsuario = quitarCursoUsuario;
window.quitarAlumnoPATUsuario = quitarAlumnoPATUsuario;
window.eliminarUsuario = abrirModalConfirmarEliminarUsuario;
window.cerrarModalConfirmarEliminarUsuario = cerrarModalConfirmarEliminarUsuario;
window.confirmarEliminarUsuario = confirmarEliminarUsuario;
window.abrirModalConfirmarEstadoUsuario = abrirModalConfirmarEstadoUsuario;
window.cerrarModalConfirmarEstadoUsuario = cerrarModalConfirmarEstadoUsuario;

// ==================== VER CONTRASEÑA ====================
window.abrirModalCambiarPassword = abrirModalCambiarPassword;
window.cerrarModalCambiarPassword = cerrarModalCambiarPassword;
window.confirmarCambiarPassword = confirmarCambiarPassword;

window.togglePassword = function(inputId, btn) {
    const input = document.getElementById(inputId);
    const icon = btn.querySelector('i');
    if (!input || !icon) return;
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
        btn.classList.add('text-blue-500');
        btn.classList.remove('text-slate-400');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
        btn.classList.remove('text-blue-500');
        btn.classList.add('text-slate-400');
    }
};
