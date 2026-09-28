import { usuarios, cargarUsuariosSupa, getDB, saveDB, setUsuarios, perfil } from './db.js';
import { USE_SUPABASE, supabaseClient } from './config.js';
import { mostrarToast } from './app.js';

export async function cargarUsuarios() {
    if (perfil.rol !== 'regente') return;
    await cargarUsuariosSupa();
    const lista = usuarios.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    document.getElementById('listaUsuarios').innerHTML = lista.map(u => `
        <tr class="hover:bg-slate-50">
            <td class="px-4 py-3 font-medium">${u.apellido}, ${u.nombre}</td>
            <td class="px-4 py-3 text-slate-500">${u.email}</td>
            <td class="px-4 py-3"><span class="px-2 py-1 rounded-full text-xs font-medium capitalize ${u.rol === 'regente' ? 'bg-purple-100 text-purple-700' : u.rol === 'preceptor' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}">${u.rol}</span></td>
            <td class="px-4 py-3"><span class="px-2 py-1 rounded-full text-xs font-medium ${u.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
            <td class="px-4 py-3">
                ${u.id !== perfil.id ? `<button onclick="toggleUsuario('${u.id}', ${!u.activo})" class="text-sm ${u.activo ? 'text-red-600 hover:text-red-700' : 'text-green-600 hover:text-green-700'}">${u.activo ? 'Desactivar' : 'Activar'}</button>` : '<span class="text-xs text-slate-400">Usted</span>'}
            </td>
        </tr>
    `).join('');
}

export async function crearUsuario(e) {
    e.preventDefault();
    const email = document.getElementById('newEmail').value.trim().toLowerCase();
    const password = document.getElementById('newPassword').value;
    const nombre = document.getElementById('newNombre').value.trim();
    const apellido = document.getElementById('newApellido').value.trim();
    const rol = document.getElementById('newRol').value;

    if (USE_SUPABASE) {
        
        const { data: authData, error: authError } = await supabaseClient.auth.signUp({
            email, password,
            options: { data: { nombre, apellido, rol } }
        });
        if (authError) { 
        
        mostrarToast('Usuario creado. El perfil se generará automáticamente.');
    } else {
        const db = getDB();
        if (db.usuarios.find(u => u.email === email)) return mostrarToast('El email ya está registrado', 'error');
        db.usuarios.push({
            id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2),
            email, password, nombre, apellido, rol, activo: true,
            created_at: new Date().toISOString()
        });
        saveDB(db);
        mostrarToast('Usuario creado correctamente');
    }
    document.getElementById('formUsuario').reset();
    await cargarUsuarios();
}

export async function toggleUsuario(id, activo) {
    if (USE_SUPABASE) {
        const { error } = await supabaseClient.from('perfiles').update({ activo }).eq('id', id);
        if (error) { 
        
        await cargarUsuariosSupa();
    } else {
        const db = getDB();
        const idx = db.usuarios.findIndex(u => u.id === id);
        db.usuarios[idx].activo = activo;
        saveDB(db);
        setUsuarios(db.usuarios);
    }
    mostrarToast(`Usuario ${activo ? 'activado' : 'desactivado'}`);
    await cargarUsuarios();
}
