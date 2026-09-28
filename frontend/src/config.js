// ============================================================
// GIE On-Premise: Adaptador de Cliente Local
// Emula la interfaz de Supabase sobre la API REST Express propia
// ============================================================

import { api } from './api.js';

export const API_BASE_URL = '/api';
export const GIE_URL = '/api';
export const GIE_KEY = 'gie_local_key';
export const USE_SUPABASE = true; // Activo para ejecutar los flujos de datos reales
export const IS_ONPREM = true;

class SupabaseQueryBuilder {
    constructor(tabla) {
        this.tabla = tabla;
        this.operacion = 'SELECT';
        this.body = null;
        this.filtros = {};
        this.idTarget = null;
        this.ordenCol = null;
        this.ordenAsc = true;
    }

    select(campos = '*') {
        if (this.operacion !== 'INSERT') {
            this.operacion = 'SELECT';
        }
        return this;
    }

    insert(datos) {
        this.operacion = 'INSERT';
        this.body = datos;
        return this;
    }

    update(datos) {
        this.operacion = 'UPDATE';
        this.body = datos;
        return this;
    }

    delete() {
        this.operacion = 'DELETE';
        return this;
    }

    eq(columna, valor) {
        if (columna === 'id') {
            this.idTarget = valor;
        }
        this.filtros[columna] = valor;
        return this;
    }

    neq(columna, valor) {
        this.filtros[`${columna}_neq`] = valor;
        return this;
    }

    in(columna, valores) {
        this.filtros[`${columna}_in`] = valores;
        return this;
    }

    order(columna, opts = { ascending: true }) {
        this.ordenCol = columna;
        this.ordenAsc = opts.ascending !== false;
        return this;
    }

    limit(n) {
        this.filtros['limit'] = n;
        return this;
    }

    single() {
        this.esSingle = true;
        return this;
    }

    async execute() {
        try {
            // Mapeo de tablas de Supabase hacia endpoints Express
            if (this.tabla === 'informes') {
                if (this.operacion === 'SELECT') {
                    if (this.idTarget) {
                        const res = await api.get(`/informes/${this.idTarget}`);
                        return { data: res.data || null, error: null };
                    }
                    const res = await api.get('/informes', this.filtros);
                    return { data: res.data || [], error: null };
                }
                if (this.operacion === 'INSERT') {
                    const res = await api.post('/informes', this.body);
                    return { data: res.data ? [res.data] : [], error: null };
                }
                if (this.operacion === 'UPDATE') {
                    if (!this.idTarget) throw new Error('ID requerido para actualizar informe');
                    const res = await api.put(`/informes/${this.idTarget}`, this.body);
                    return { data: res.data ? [res.data] : [], error: null };
                }
            }

            if (this.tabla === 'alumnos') {
                if (this.operacion === 'SELECT') {
                    if (this.idTarget) {
                        const res = await api.get(`/alumnos/${this.idTarget}`);
                        return { data: res.data || null, error: null };
                    }
                    const res = await api.get('/alumnos', this.filtros);
                    return { data: res.data || [], error: null };
                }
            }

            if (this.tabla === 'categorias') {
                if (this.operacion === 'SELECT') {
                    const res = await api.get('/categorias');
                    return { data: res.data || [], error: null };
                }
                if (this.operacion === 'INSERT') {
                    const res = await api.post('/categorias', this.body);
                    return { data: res.data ? [res.data] : [], error: null };
                }
                if (this.operacion === 'DELETE') {
                    if (!this.idTarget) throw new Error('ID requerido para eliminar categoría');
                    await api.delete(`/categorias/${this.idTarget}`);
                    return { error: null };
                }
            }

            if (this.tabla === 'plantillas') {
                if (this.operacion === 'SELECT') {
                    const res = await api.get('/plantillas');
                    return { data: res.data || [], error: null };
                }
                if (this.operacion === 'INSERT') {
                    const res = await api.post('/plantillas', this.body);
                    return { data: res.data ? [res.data] : [], error: null };
                }
                if (this.operacion === 'DELETE') {
                    if (!this.idTarget) throw new Error('ID requerido para eliminar plantilla');
                    await api.delete(`/plantillas/${this.idTarget}`);
                    return { error: null };
                }
            }

            if (this.tabla === 'perfiles') {
                if (this.operacion === 'SELECT') {
                    const res = await api.get('/usuarios');
                    let list = res.data || [];
                    if (this.idTarget) {
                        list = list.filter(u => u.id === this.idTarget);
                    }
                    return { data: this.esSingle ? list[0] || null : list, error: null };
                }
                if (this.operacion === 'UPDATE') {
                    if (!this.idTarget) throw new Error('ID requerido para actualizar perfil');
                    const res = await api.put(`/usuarios/${this.idTarget}`, this.body);
                    return { data: res.data ? [res.data] : [], error: null };
                }
            }

            if (this.tabla === 'observaciones_alumno') {
                if (this.operacion === 'INSERT') {
                    const alumnoId = this.body?.alumno_id;
                    const res = await api.post(`/alumnos/${alumnoId}/observaciones`, this.body);
                    return { data: res.data ? [res.data] : [], error: null };
                }
                if (this.operacion === 'DELETE') {
                    if (!this.idTarget) throw new Error('ID requerido para eliminar observación');
                    await api.delete(`/alumnos/observaciones/${this.idTarget}`);
                    return { error: null };
                }
            }

            if (this.tabla === 'tipos_observacion_alumno') {
                if (this.operacion === 'SELECT') {
                    const res = await api.get('/alumnos/tipos-observacion');
                    return { data: res.data || [], error: null };
                }
            }

            if (this.tabla === 'historial_informes') {
                if (this.operacion === 'INSERT') {
                    const informeId = this.body?.informe_id;
                    if (informeId) {
                        const res = await api.post(`/informes/${informeId}/historial`, this.body);
                        return { data: res.data ? [res.data] : [], error: null };
                    }
                }
                if (this.operacion === 'SELECT') {
                    const informeId = this.filtros?.informe_id;
                    if (informeId) {
                        const res = await api.get(`/informes/${informeId}/historial`);
                        return { data: res.data || [], error: null };
                    }
                }
                return { data: [], error: null };
            }

            return { data: [], error: null };
        } catch (err) {
            console.error(`[API-ADAPTER] Error en tabla ${this.tabla} (${this.operacion}):`, err);
            return { data: null, error: err };
        }
    }

    // Permitir await directo del QueryBuilder
    then(onFulfilled, onRejected) {
        return this.execute().then(onFulfilled, onRejected);
    }
}

export const supabaseClient = {
    from(tabla) {
        return new SupabaseQueryBuilder(tabla);
    },

    async rpc(funcion, params = {}) {
        try {
            if (funcion === 'devolver_informe_a_pendiente') {
                const id = params.p_informe_id;
                const res = await api.put(`/informes/${id}/estado`, { nuevo_estado: 'pendiente' });
                return { data: res.data, error: null };
            }
            if (funcion === 'obtener_espacio_bd') {
                return { data: { total_mb: 500, used_mb: 25 }, error: null };
            }
            if (funcion === 'eliminar_usuario_completo') {
                await api.put(`/usuarios/${params.user_id}`, { activo: false });
                return { error: null };
            }
            return { data: null, error: null };
        } catch (err) {
            return { data: null, error: err };
        }
    },

    auth: {
        async getSession() {
            const token = api.getToken();
            const user = api.getUser();
            return {
                data: {
                    session: token ? { access_token: token, user } : null
                },
                error: null
            };
        },

        async getUser() {
            const user = api.getUser();
            return { data: { user }, error: null };
        },

        async signOut() {
            api.clearSession();
            return { error: null };
        },

        async signInWithPassword({ email, password }) {
            try {
                const res = await api.login(email, password);
                return { data: { session: { access_token: res.token, user: res.user } }, error: null };
            } catch (err) {
                return { data: { session: null }, error: err };
            }
        }
    },

    channel(nombre) {
        return {
            on(evento, filtro, callback) {
                return this;
            },
            subscribe(callback) {
                if (callback) callback('SUBSCRIBED');
                return this;
            }
        };
    }
};

if (typeof window !== 'undefined') {
    window.supabaseClient = supabaseClient;
}
