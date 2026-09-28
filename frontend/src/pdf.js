import { getInforme, getAlumno, getNombreUsuario } from './db.js';
import { formatearFecha } from './app.js';
import html2pdf from 'html2pdf.js';

export function exportarPDF(id) {
    const informe = getInforme(id);
    if (!informe) return;
    const alumno = getAlumno(informe.alumno_id);
    const container = document.createElement('div');
    container.style.cssText = 'padding:40px; font-family:Inter,sans-serif; color:#334155; max-width:800px; margin:0 auto; background:#fff;';
    container.innerHTML = `
        <div style="text-align:center; margin-bottom:30px; border-bottom:3px solid #3b82f6; padding-bottom:20px;">
            <h1 style="font-size:24px; color:#1e293b; margin:0;">GIE - Gestor de Informes Escolares</h1>
            <p style="font-size:14px; color:#64748b; margin:5px 0 0;">Informe Oficial</p>
        </div>
        <div style="margin-bottom:20px;">
            <span style="display:inline-block; padding:4px 12px; border-radius:999px; font-size:12px; font-weight:600; text-transform:capitalize; ${
                informe.estado === 'aprobado' ? 'background:#d1fae5; color:#065f46;' :
                informe.estado === 'rechazado' ? 'background:#fee2e2; color:#991b1b;' :
                informe.estado === 'pendiente' ? 'background:#dbeafe; color:#1e40af;' :
                'background:#fef3c7; color:#92400e;'
            }">${informe.estado.replace('_', ' ')}</span>
            <span style="font-size:13px; color:#64748b; margin-left:10px;">${formatearFecha(informe.fecha_creacion)}</span>
        </div>
        <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
            <tr><td style="padding:8px 0; font-weight:600; width:140px;">Alumno:</td><td style="padding:8px 0;">${alumno ? `${alumno.apellido}, ${alumno.nombre}` : 'Desconocido'}</td></tr>
            <tr><td style="padding:8px 0; font-weight:600;">Curso:</td><td style="padding:8px 0;">${alumno ? `${alumno.curso} ${alumno.division}` : ''}</td></tr>
            <tr><td style="padding:8px 0; font-weight:600;">Tipo de falta:</td><td style="padding:8px 0;">${informe.tipo_falta}</td></tr>
            <tr><td style="padding:8px 0; font-weight:600;">Instancia:</td><td style="padding:8px 0; text-transform:capitalize; font-weight:600; ${informe.instancia==='muy_grave'?'color:#dc2626;':informe.instancia==='grave'?'color:#ea580c;':'color:#d97706;'}">${informe.instancia}</td></tr>
            <tr><td style="padding:8px 0; font-weight:600;">Creado por:</td><td style="padding:8px 0;">${getNombreUsuario(informe.creado_por)}</td></tr>
            ${informe.fecha_revision ? `<tr><td style="padding:8px 0; font-weight:600;">Revisado por:</td><td style="padding:8px 0;">${getNombreUsuario(informe.revisado_por)} el ${formatearFecha(informe.fecha_revision)}</td></tr>` : ''}
        </table>
        <div style="margin-bottom:20px;">
            <h3 style="font-size:14px; font-weight:700; color:#1e293b; margin-bottom:8px;">Título</h3>
            <p style="margin:0; line-height:1.6;">${informe.titulo}</p>
        </div>
        <div style="margin-bottom:20px;">
            <h3 style="font-size:14px; font-weight:700; color:#1e293b; margin-bottom:8px;">Resumen</h3>
            <p style="margin:0; line-height:1.6; white-space:pre-wrap;">${informe.resumen}</p>
        </div>
        ${informe.descargo ? `
        <div style="margin-bottom:20px; background:#fffbeb; border:1px solid #fcd34d; padding:16px; border-radius:8px;">
            <h3 style="font-size:14px; font-weight:700; color:#92400e; margin-bottom:8px;">Descargo del alumno</h3>
            <p style="margin:0; line-height:1.6; white-space:pre-wrap; color:#78350f;">${informe.descargo}</p>
        </div>` : ''}
        ${informe.motivo_rechazo ? `
        <div style="margin-bottom:20px; background:#fef2f2; border:1px solid #fecaca; padding:16px; border-radius:8px;">
            <h3 style="font-size:14px; font-weight:700; color:#991b1b; margin-bottom:8px;">Motivo del rechazo</h3>
            <p style="margin:0; line-height:1.6; color:#7f1d1d;">${informe.motivo_rechazo}</p>
        </div>` : ''}
        <div style="margin-top:40px; padding-top:20px; border-top:1px solid #e2e8f0; text-align:center; font-size:12px; color:#94a3b8;">
            Documento generado automáticamente por GIE • ${new Date().toLocaleDateString('es-AR')}
        </div>
    `;
    document.body.appendChild(container);
    html2pdf().set({ margin: 0, filename: `informe_${alumno ? alumno.apellido : 'doc'}_${informe.fecha_creacion.split('T')[0]}.pdf`, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(container).save().then(() => { document.body.removeChild(container); });
}
