import { getInforme, getDB, saveDB, cargarInformes, perfil } from './db.js';
import { USE_SUPABASE, supabaseClient } from './config.js';
import { mostrarToast, limpiarAlumno, showSection, generarId } from './app.js';

export async function guardarInforme(e) {
    e.preventDefault();
    const alumnoId = document.getElementById('alumnoId').value;
    if (!alumnoId) return mostrarToast('Debe seleccionar un alumno', 'error');
    const editId = document.getElementById('editId').value;
    const datos = {
        alumno_id: alumnoId,
        tipo_falta: document.getElementById('tipoFalta').value,
        instancia: document.getElementById('instancia').value,
        titulo: document.getElementById('titulo').value.trim(),
        resumen: document.getElementById('resumen').value.trim(),
        descargo: document.getElementById('descargo').value.trim() || null
    };

    if (editId) {
        const inf = getInforme(editId);
        if (!inf) return mostrarToast('Informe no encontrado', 'error');
        if (inf.estado === 'aprobado') return mostrarToast('No se puede editar un informe aprobado', 'error');
        if (inf.creado_por !== perfil.id && perfil.rol !== 'regente') return mostrarToast('No tiene permiso para editar', 'error');

        if (USE_SUPABASE) {
            const { error } = await supabaseClient.from('informes').update(datos).eq('id', editId);
            if (error) {
                console.error('[GIE] Error actualizando informe:', error);
                mostrarToast('Error al actualizar informe', 'error');
                return;
            }
            await cargarInformes();
        } else {
            const db = getDB();
            const idx = db.informes.findIndex(i => i.id === editId);
            db.informes[idx] = { ...db.informes[idx], ...datos };
            saveDB(db);
            await cargarInformes();
        }
        mostrarToast('Informe actualizado correctamente');
    } else {
        const nuevo = {
            id: generarId(),
            ...datos,
            estado: 'pendiente',
            creado_por: perfil.id,
            revisado_por: null,
            fecha_creacion: new Date().toISOString(),
            fecha_revision: null,
            motivo_rechazo: null
        };
        if (USE_SUPABASE) {
            const { data: insertData, error } = await supabaseClient.from('informes').insert(nuevo).select('id');
            if (error) {
                console.error('[GIE] Error creando informe:', error);
                mostrarToast('Error al crear informe', 'error');
                return;
            }
            await cargarInformes();
        } else {
            const db = getDB();
            db.informes.push(nuevo);
            saveDB(db);
            await cargarInformes();
        }
        mostrarToast('Informe creado correctamente');
    }
    cancelarForm();
    showSection('informes');
}

export function cancelarForm() {
    document.getElementById('formInforme').reset();
    limpiarAlumno();
    document.getElementById('editId').value = '';
    document.getElementById('tituloForm').textContent = 'Nuevo Informe';
    document.getElementById('txtBtnGuardar').textContent = 'Guardar Informe';
}
