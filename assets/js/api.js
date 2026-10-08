/* =====================================================================
   CAPA DE DATOS
   Dos implementaciones con la misma forma:
     · supabaseApi  → la real (tablas tickets / responsables + bucket de fotos)
     · demoApi      → en memoria del navegador, para probar sin base de datos
   El resto de la app solo habla con el objeto que devuelve createApi().
   ===================================================================== */

import { SUPABASE_URL, SUPABASE_ANON_KEY, LS_KEYS } from './config.js';

const BUCKET = 'tickets-fotos';

const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};

export function getConnection() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY, fija: true };
  const saved = ls.get(LS_KEYS.connection);
  return saved?.url && saved?.key ? saved : null;
}
export const saveConnection = (url, key) =>
  ls.set(LS_KEYS.connection, { url: url.trim().replace(/\/+$/, ''), key: key.trim() });
export const clearConnection = () => ls.remove(LS_KEYS.connection);
export const isDemo = () => ls.get(LS_KEYS.demo) === true;
export const setDemo = (on) => (on ? ls.set(LS_KEYS.demo, true) : ls.remove(LS_KEYS.demo));

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/** Reduce la foto del celular (≈4 MB) a un JPG de ≈250 KB antes de subirla. */
export async function comprimirFoto(file, max = 1600, calidad = 0.82) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file);
    const escala = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', calidad));
    return blob ?? file;
  } catch {
    return file; // formatos que el navegador no sabe abrir (p. ej. HEIC en Windows) se suben tal cual
  }
}

/* ==================================================================
   SUPABASE
   ================================================================== */
function supabaseApi(conn) {
  const sb = window.supabase.createClient(conn.url, conn.key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const urlCache = new Map(); // ruta → { url, vence }

  return {
    modo: 'supabase',

    auth: {
      async session() { return (await sb.auth.getSession()).data?.session ?? null; },
      async signIn(email, password) { return unwrap(await sb.auth.signInWithPassword({ email: email.trim(), password })); },
      async signOut() { await sb.auth.signOut(); },
    },

    async listResponsables() {
      return unwrap(await sb.from('responsables').select('*').order('created_at'));
    },
    async saveResponsable({ id, ...datos }) {
      const q = id ? sb.from('responsables').update(datos).eq('id', id) : sb.from('responsables').insert(datos);
      return unwrap(await q.select().single());
    },
    async deleteResponsable(id) {
      unwrap(await sb.from('responsables').delete().eq('id', id));
    },

    async listTickets() {
      return unwrap(await sb.from('tickets').select('*').order('fecha_entrega').order('folio'));
    },
    async saveTicket({ id, ...datos }) {
      const q = id ? sb.from('tickets').update(datos).eq('id', id) : sb.from('tickets').insert(datos);
      return unwrap(await q.select().single());
    },
    async deleteTicket(ticket) {
      unwrap(await sb.from('tickets').delete().eq('id', ticket.id));
      if (ticket.fotos?.length) await sb.storage.from(BUCKET).remove(ticket.fotos);
    },

    async uploadFoto(file) {
      const blob = await comprimirFoto(file);
      const ext = blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'img').toLowerCase();
      const ruta = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
      unwrap(await sb.storage.from(BUCKET).upload(ruta, blob, { contentType: blob.type || file.type }));
      return ruta;
    },
    async removeFotos(rutas) {
      if (rutas.length) await sb.storage.from(BUCKET).remove(rutas);
    },
    /** Enlaces temporales (el bucket es privado). Se cachean 50 min. */
    async fotoUrls(rutas) {
      const ahora = Date.now();
      const faltan = [...new Set(rutas)].filter(r => !(urlCache.get(r)?.vence > ahora));
      if (faltan.length) {
        const data = unwrap(await sb.storage.from(BUCKET).createSignedUrls(faltan, 3600));
        for (const d of data) if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, vence: ahora + 50 * 60e3 });
      }
      return Object.fromEntries(rutas.map(r => [r, urlCache.get(r)?.url ?? '']));
    },

    subscribe(onChange) {
      const canal = sb.channel('tablero')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'responsables' }, onChange)
        .subscribe();
      return () => sb.removeChannel(canal);
    },
  };
}

/* ==================================================================
   DEMO (en memoria; se pierde al recargar)
   ================================================================== */
function demoApi() {
  const hoy = new Date();
  const dia = (n) => { const d = new Date(hoy); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  const muestra = (fondo, texto) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="${fondo}"/>` +
    `<rect x="170" y="90" width="300" height="240" rx="6" fill="#fff" opacity=".92"/>` +
    `<text x="320" y="222" font-family="Arial" font-size="28" font-weight="700" text-anchor="middle" fill="#333">${texto}</text></svg>`);

  const R = [
    { id: 'r1', nombre: 'Lupita', color: '#e11d48', activo: true },
    { id: 'r2', nombre: 'Toño', color: '#2563eb', activo: true },
    { id: 'r3', nombre: 'Sofía', color: '#059669', activo: true },
  ];
  let folio = 1040;
  const T = [
    ['Colegio Montessori Valle', '81 1234 5678', 'Engargolado de 40 cuadernillos', 'Engargolar 40 juegos de 25 hojas. Espiral negro, portada de acetato transparente y contraportada de cartulina negra. Separar por grupo (1°A, 1°B).', -2, 0, 'r1', 'en_proceso', 'urgente', muestra('#fcd34d', 'Cuadernillo 1°A')],
    ['Sra. Martha Leal', '81 2222 3344', 'Invitaciones XV años', '120 invitaciones en papel perlado 250 g, tamaño 5x7". Impresión a color frente, vuelta en blanco. Sobre dorado con listón. Revisar nombre: "Valeria Sofía".', -3, 2, 'r2', 'pendiente', 'normal', muestra('#f9a8d4', 'Mis XV · Valeria')],
    ['Taller Mecánico Ruiz', '', 'Tarjetas de presentación', '500 tarjetas, couché 300 g mate, a dos caras. Logo en la foto. Teléfono nuevo: 81 5555 0101.', -1, 1, 'r3', 'pendiente', 'normal', muestra('#93c5fd', 'TALLER RUIZ')],
    ['Despacho Garza & Asoc.', '81 8888 1111', 'Copias y engargolado de contrato', '12 juegos de 60 hojas, blanco y negro, doble cara. Engargolado con pasta azul marino.', -4, -1, 'r1', 'pendiente', 'urgente', ''],
    ['Iglesia San Juan', '', 'Lona 2 x 1 m', 'Lona para kermés con ojillos en las 4 esquinas. Diseño aprobado en foto.', -5, 0, 'r2', 'listo', 'normal', muestra('#86efac', 'KERMÉS 2026')],
    ['Juan Pérez', '81 4444 9090', 'Enmicado de actas', 'Enmicar 6 actas de nacimiento tamaño carta, mica gruesa.', -6, -2, 'r3', 'entregado', 'normal', ''],
    ['Primaria Benito Juárez', '', 'Diplomas fin de curso', '85 diplomas en opalina, nombres en la lista adjunta (foto). Firma digital del director.', 0, 6, null, 'pendiente', 'normal', muestra('#c4b5fd', 'DIPLOMA')],
  ].map(([cliente, telefono, trabajo, instrucciones, ini, ent, resp, estado, prioridad, foto]) => ({
    id: crypto.randomUUID(), folio: ++folio, cliente, telefono, trabajo, instrucciones,
    fotos: foto ? [foto] : [], fecha_inicio: dia(ini), fecha_entrega: dia(ent),
    responsable_id: resp, estado, prioridad, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }));

  const listeners = new Set();
  const avisar = () => setTimeout(() => listeners.forEach(fn => fn()), 0);
  const copia = (o) => structuredClone(o);

  return {
    modo: 'demo',
    auth: { async session() { return { user: { email: 'demo@papeleria' } }; }, async signIn() {}, async signOut() {} },

    async listResponsables() { return copia(R); },
    async saveResponsable({ id, ...datos }) {
      let r = R.find(x => x.id === id);
      if (r) Object.assign(r, datos); else R.push(r = { id: crypto.randomUUID(), activo: true, ...datos });
      avisar(); return copia(r);
    },
    async deleteResponsable(id) {
      R.splice(R.findIndex(x => x.id === id), 1);
      T.forEach(t => { if (t.responsable_id === id) t.responsable_id = null; });
      avisar();
    },

    async listTickets() { return copia(T); },
    async saveTicket({ id, ...datos }) {
      let t = T.find(x => x.id === id);
      if (t) Object.assign(t, datos, { updated_at: new Date().toISOString() });
      else T.push(t = { id: crypto.randomUUID(), folio: ++folio, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...datos });
      avisar(); return copia(t);
    },
    async deleteTicket(ticket) { T.splice(T.findIndex(x => x.id === ticket.id), 1); avisar(); },

    async uploadFoto(file) {
      const blob = await comprimirFoto(file);
      return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    },
    async removeFotos() {},
    async fotoUrls(rutas) { return Object.fromEntries(rutas.map(r => [r, r])); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

export function createApi() {
  if (isDemo()) return demoApi();
  const conn = getConnection();
  if (!conn) return null;
  if (!window.supabase?.createClient) throw new Error('No se pudo cargar Supabase. Revisa tu conexión a internet.');
  return supabaseApi(conn);
}
