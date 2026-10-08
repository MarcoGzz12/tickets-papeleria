/* =====================================================================
   TABLERO DE TRABAJOS — lógica de la app
   ===================================================================== */

import { APP_NAME, LS_KEYS } from './config.js';
import { createApi, getConnection, saveConnection, clearConnection, setDemo, isDemo } from './api.js';

const ESTADOS = [
  { id: 'pendiente',  nombre: 'Por hacer',           icono: '📥', siguiente: 'Empezar' },
  { id: 'en_proceso', nombre: 'En proceso',          icono: '🛠️', siguiente: 'Marcar listo' },
  { id: 'listo',      nombre: 'Listo para entregar', icono: '📦', siguiente: 'Entregado' },
  { id: 'entregado',  nombre: 'Entregado',           icono: '✅' },
];
const PALETA = ['#e11d48', '#ea580c', '#d97706', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777', '#475569'];
const MAX_ENTREGADOS = 15;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const estado = {
  api: null,
  sesion: null,
  responsables: [],
  tickets: [],
  urls: {},
  filtroResp: localStorage.getItem(LS_KEYS.filtro) || 'todos',
  vista: localStorage.getItem(LS_KEYS.vista) || 'compacta', // 'compacta' | 'fotos'
  foco: null, // atajo desde los indicadores: 'hoy' | 'vencidos' | 'listos'
  busqueda: '',
};

const FOCOS = {
  hoy:      (t) => t.estado !== 'entregado' && diasHasta(t.fecha_entrega) === 0,
  vencidos: (t) => t.estado !== 'entregado' && diasHasta(t.fecha_entrega) < 0,
  listos:   (t) => t.estado === 'listo',
};

/* ------------------------------------------------------------------
   Fechas
   ------------------------------------------------------------------ */
const hoyISO = () => new Date().toLocaleDateString('en-CA');
const aFecha = (iso) => new Date(iso + 'T00:00:00');
const diasHasta = (iso) => Math.round((aFecha(iso) - aFecha(hoyISO())) / 864e5);
const fmtCorta = (iso) => aFecha(iso).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtLarga = (iso) => aFecha(iso).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

function vencimiento(t) {
  if (t.estado === 'entregado') return { cls: 'ok', texto: 'Entregado' };
  const d = diasHasta(t.fecha_entrega);
  if (d < 0) return { cls: 'vencido', texto: d === -1 ? 'Venció ayer' : `Vencido hace ${-d} días` };
  if (d === 0) return { cls: 'hoy', texto: 'Se entrega HOY' };
  if (d === 1) return { cls: 'pronto', texto: 'Mañana' };
  if (d <= 3) return { cls: 'pronto', texto: `En ${d} días` };
  return { cls: 'normal', texto: fmtCorta(t.fecha_entrega) };
}

/* ------------------------------------------------------------------
   Utilidades de UI
   ------------------------------------------------------------------ */
let toastTimer;
function toast(msg, tipo = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast ' + tipo;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

function mensajeError(e) {
  const m = e?.message || String(e);
  if (/Invalid login/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/fechas_en_orden/.test(m)) return 'La fecha de entrega no puede ser antes de la de inicio.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión con el servidor. Revisa internet.';
  if (/relation .* does not exist|schema cache/i.test(m)) return 'Falta instalar la base: corre database/instalar.sql en Supabase.';
  return m;
}

function mostrar(pantalla) {
  for (const p of ['conexion', 'login', 'app']) $('#pantalla-' + p).hidden = p !== pantalla;
}

const responsable = (id) => estado.responsables.find(r => r.id === id);
const iniciales = (nombre) => nombre.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();

function avatar(r, grande = false) {
  if (!r) return `<span class="avatar vacio ${grande ? 'grande' : ''}" title="Sin asignar">?</span>`;
  return `<span class="avatar ${grande ? 'grande' : ''}" style="--c:${esc(r.color)}" title="${esc(r.nombre)}">${esc(iniciales(r.nombre))}</span>`;
}

/* ------------------------------------------------------------------
   Datos
   ------------------------------------------------------------------ */
async function recargar() {
  try {
    const [responsables, tickets] = await Promise.all([estado.api.listResponsables(), estado.api.listTickets()]);
    estado.responsables = responsables;
    estado.tickets = tickets;
    const rutas = tickets.flatMap(t => t.fotos ?? []);
    if (rutas.length) Object.assign(estado.urls, await estado.api.fotoUrls(rutas));
    pintar();
    if ($('#dlg-ajustes').open) pintarAjustes();
    if ($('#dlg-ver').open) {
      const t = estado.tickets.find(x => x.id === $('#dlg-ver').dataset.id);
      t ? pintarVer(t) : $('#dlg-ver').close();
    }
  } catch (e) {
    toast(mensajeError(e), 'error');
  }
}

let recargaPendiente;
const recargarPronto = () => { clearTimeout(recargaPendiente); recargaPendiente = setTimeout(recargar, 300); };

function ticketsVisibles() {
  const q = estado.busqueda.trim().toLowerCase();
  return estado.tickets.filter(t => {
    if (estado.foco && !FOCOS[estado.foco](t)) return false;
    if (estado.filtroResp === 'sin' && t.responsable_id) return false;
    if (!['todos', 'sin'].includes(estado.filtroResp) && t.responsable_id !== estado.filtroResp) return false;
    if (!q) return true;
    return [t.cliente, t.trabajo, t.instrucciones, t.telefono, '#' + t.folio, String(t.folio)]
      .some(v => String(v ?? '').toLowerCase().includes(q));
  });
}

/* ------------------------------------------------------------------
   Tablero
   ------------------------------------------------------------------ */
function pintar() {
  $('#app-fecha').textContent = fmtLarga(hoyISO());
  pintarKpis();
  pintarFiltroResp();
  pintarVista();
  pintarTablero();
}

function pintarVista() {
  $$('[data-vista]').forEach(b => b.classList.toggle('activo', b.dataset.vista === estado.vista));
}

function pintarKpis() {
  const cuenta = (f) => estado.tickets.filter(FOCOS[f]).length;
  const kpis = [
    { foco: null, n: estado.tickets.filter(t => t.estado !== 'entregado').length, t: 'Trabajos activos', cls: '' },
    { foco: 'hoy', n: cuenta('hoy'), t: 'Se entregan hoy', cls: 'hoy' },
    { foco: 'vencidos', n: cuenta('vencidos'), t: 'Vencidos', cls: 'vencido' },
    { foco: 'listos', n: cuenta('listos'), t: 'Listos para entregar', cls: 'listo' },
  ];
  $('#kpis').innerHTML = kpis.map(k => `
    <button class="kpi ${k.cls} ${k.n ? '' : 'cero'} ${estado.foco === k.foco ? 'activo' : ''}" data-foco="${k.foco ?? ''}"
      title="${k.foco ? 'Ver solo estos' : 'Ver todos'}"><b>${k.n}</b><span>${k.t}</span></button>`).join('');
}

function pintarFiltroResp() {
  const activos = estado.tickets.filter(t => t.estado !== 'entregado');
  const cuenta = (id) => activos.filter(t => (id === 'sin' ? !t.responsable_id : t.responsable_id === id)).length;
  const chips = [
    { id: 'todos', html: 'Todos', n: activos.length },
    ...estado.responsables.filter(r => r.activo || cuenta(r.id)).map(r => ({ id: r.id, html: `${avatar(r)} ${esc(r.nombre)}`, n: cuenta(r.id) })),
  ];
  if (cuenta('sin')) chips.push({ id: 'sin', html: `${avatar(null)} Sin asignar`, n: cuenta('sin') });
  if (!chips.some(c => c.id === estado.filtroResp)) estado.filtroResp = 'todos';
  $('#filtro-responsables').innerHTML = chips.map(c =>
    `<button class="chip ${c.id === estado.filtroResp ? 'activo' : ''}" data-filtro="${esc(c.id)}">${c.html}<em>${c.n}</em></button>`).join('');
}

/*
  Tarjeta = lo que se escanea desde lejos (qué, para quién, cuándo, quién).
  Las instrucciones completas viven dentro del ticket, no en el tablero.
  El color se reserva para señales: vencido, hoy, urgente.
*/
function tarjeta(t) {
  const r = responsable(t.responsable_id);
  const v = vencimiento(t);
  const foto = t.fotos?.[0] && estado.urls[t.fotos[0]];
  const extra = t.fotos?.length > 1 ? `<span class="mas-fotos">+${t.fotos.length - 1}</span>` : '';
  const urgente = t.prioridad === 'urgente' ? '<span class="flama" title="Urgente">🔥</span>' : '';

  if (t.estado === 'entregado') {
    return `
    <article class="ticket mini" draggable="true" data-id="${t.id}" tabindex="0">
      <span class="folio">#${t.folio}</span>
      <span class="mini-texto"><b>${esc(t.trabajo)}</b><small>${esc(t.cliente)}</small></span>
      ${avatar(r)}
    </article>`;
  }

  const idx = ESTADOS.findIndex(e => e.id === t.estado);
  const sig = ESTADOS[idx + 1];
  const grande = estado.vista === 'fotos';
  return `
  <article class="ticket ${v.cls === 'vencido' ? 'es-vencido' : ''}" draggable="true" data-id="${t.id}" tabindex="0">
    ${grande && foto ? `<div class="ticket-foto" style="background-image:url('${esc(foto)}')">${extra}</div>` : ''}
    <div class="ticket-cuerpo">
      <div class="ticket-texto">
        <span class="folio">#${t.folio} ${urgente}</span>
        <h3>${esc(t.trabajo)}</h3>
        <p class="cliente">${esc(t.cliente)}</p>
        ${grande && t.instrucciones ? `<p class="instr">${esc(t.instrucciones)}</p>` : ''}
      </div>
      ${!grande && foto ? `<div class="miniatura" style="background-image:url('${esc(foto)}')">${extra}</div>` : ''}
    </div>
    <footer class="ticket-pie">
      <span class="entrega ${v.cls}">${esc(v.texto)}</span>
      ${sig ? `<button class="btn-avanzar" data-avanzar="${sig.id}" title="Mover a ${sig.nombre}">${ESTADOS[idx].siguiente} →</button>` : ''}
      ${avatar(r)}
    </footer>
  </article>`;
}

function pintarTablero() {
  const lista = ticketsVisibles();
  const orden = (a, b) =>
    (b.prioridad === 'urgente') - (a.prioridad === 'urgente') || a.fecha_entrega.localeCompare(b.fecha_entrega) || a.folio - b.folio;

  $('#tablero').innerHTML = ESTADOS.map(e => {
    let col = lista.filter(t => t.estado === e.id);
    let nota = '';
    if (e.id === 'entregado') {
      col.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      if (col.length > MAX_ENTREGADOS) { nota = `<p class="nota-col">Mostrando los ${MAX_ENTREGADOS} más recientes de ${col.length}. Usa el buscador para encontrar anteriores.</p>`; col = col.slice(0, MAX_ENTREGADOS); }
    } else col.sort(orden);
    return `
    <section class="columna col-${e.id}" data-estado="${e.id}">
      <header class="col-cabeza"><span>${e.icono} ${e.nombre}</span><b>${col.length}</b></header>
      <div class="col-lista">
        ${col.map(tarjeta).join('') || `<p class="vacio-col">${estado.busqueda || estado.foco ? 'Nada coincide' : 'Sin trabajos aquí'}</p>`}
        ${nota}
      </div>
    </section>`;
  }).join('');
}

async function cambiarEstado(id, nuevo) {
  const t = estado.tickets.find(x => x.id === id);
  if (!t || t.estado === nuevo) return;
  const anterior = t.estado;
  t.estado = nuevo;
  t.updated_at = new Date().toISOString();
  pintar();
  try {
    await estado.api.saveTicket({ id, estado: nuevo });
    toast(`#${t.folio} → ${ESTADOS.find(e => e.id === nuevo).nombre}`);
  } catch (e) {
    t.estado = anterior;
    pintar();
    toast(mensajeError(e), 'error');
  }
}

/* ------------------------------------------------------------------
   Ver ticket
   ------------------------------------------------------------------ */
function abrirVer(id) {
  const t = estado.tickets.find(x => x.id === id);
  if (!t) return;
  const dlg = $('#dlg-ver');
  dlg.dataset.id = id;
  pintarVer(t);
  if (!dlg.open) dlg.showModal();
}

function pintarVer(t) {
  const r = responsable(t.responsable_id);
  const v = vencimiento(t);
  const fotos = (t.fotos ?? []).map(f => estado.urls[f]).filter(Boolean);
  const tel = (t.telefono || '').replace(/\D/g, '');
  const wa = tel.length === 10 ? '52' + tel : tel;
  const idx = ESTADOS.findIndex(e => e.id === t.estado);

  $('#dlg-ver').innerHTML = `
    <header class="dlg-cabeza">
      <div class="ver-titulo">
        <span class="folio grande">#${t.folio}</span>
        ${t.prioridad === 'urgente' ? '<span class="tag-urgente">🔥 Urgente</span>' : ''}
        <span class="badge venc-${v.cls}">📅 ${esc(v.texto)}</span>
      </div>
      <button type="button" class="btn btn-icono" data-cerrar aria-label="Cerrar">✕</button>
    </header>
    <div class="dlg-cuerpo ver-grid">
      <div class="ver-fotos">
        ${fotos.length
          ? `<img class="foto-principal" src="${esc(fotos[0])}" alt="Foto del trabajo" data-zoom>
             ${fotos.length > 1 ? `<div class="miniaturas">${fotos.map((f, i) => `<img src="${esc(f)}" alt="" class="${i ? '' : 'activa'}" data-mini>`).join('')}</div>` : ''}`
          : '<div class="sin-foto">📷<span>Sin foto de referencia</span></div>'}
      </div>
      <div class="ver-info">
        <ol class="pasos">
          ${ESTADOS.map((e, i) => `<li><button class="${i < idx ? 'hecho' : ''} ${i === idx ? 'actual' : ''}" data-estado-ver="${e.id}">${e.icono}<span>${e.nombre}</span></button></li>`).join('')}
        </ol>
        <h2 class="ver-trabajo">${esc(t.trabajo)}</h2>
        <dl class="ver-datos">
          <div><dt>Cliente</dt><dd>${esc(t.cliente)}</dd></div>
          ${t.telefono ? `<div><dt>Teléfono</dt><dd><a href="tel:${esc(tel)}">${esc(t.telefono)}</a>${wa ? ` · <a href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</dd></div>` : ''}
          <div><dt>Inicio</dt><dd>${fmtCorta(t.fecha_inicio)}</dd></div>
          <div><dt>Entrega</dt><dd><b>${fmtLarga(t.fecha_entrega)}</b></dd></div>
          <div class="ancho"><dt>Responsable</dt><dd class="con-avatar">${avatar(r, true)} ${r ? esc(r.nombre) + (r.activo ? '' : ' <small>(inactivo)</small>') : 'Sin asignar'}</dd></div>
        </dl>
        <div class="hoja-instr">
          <h4>Qué se tiene que hacer</h4>
          <p>${esc(t.instrucciones) || '<i>Sin instrucciones</i>'}</p>
        </div>
      </div>
    </div>
    <footer class="dlg-pie">
      <button class="btn btn-fantasma" data-imprimir>🖨 Imprimir hoja</button>
      <span class="espacio"></span>
      <button class="btn btn-primario" data-editar="${t.id}">✏️ Editar</button>
    </footer>`;
}

/* ------------------------------------------------------------------
   Crear / editar
   ------------------------------------------------------------------ */
const form = () => $('#form-ticket');
let edicion = null; // { ticket, fotos: [ruta], nuevas: Set, originales: [ruta] }

function abrirEditar(id = null) {
  const t = id ? estado.tickets.find(x => x.id === id) : null;
  const f = form();
  f.reset();
  $('#ticket-error').hidden = true;
  $('#editar-titulo').textContent = t ? `Editar ticket #${t.folio}` : 'Nuevo ticket';
  $('#btn-borrar-ticket').hidden = !t;

  const hoy = hoyISO();
  f.cliente.value = t?.cliente ?? '';
  f.telefono.value = t?.telefono ?? '';
  f.trabajo.value = t?.trabajo ?? '';
  f.instrucciones.value = t?.instrucciones ?? '';
  f.fecha_inicio.value = t?.fecha_inicio ?? hoy;
  f.fecha_entrega.value = t?.fecha_entrega ?? '';
  f.urgente.checked = t?.prioridad === 'urgente';

  const opciones = estado.responsables.filter(r => r.activo || r.id === t?.responsable_id);
  f.responsable_id.innerHTML = `<option value="">— Sin asignar —</option>` +
    opciones.map(r => `<option value="${r.id}">${esc(r.nombre)}${r.activo ? '' : ' (inactivo)'}</option>`).join('');
  f.responsable_id.value = t?.responsable_id ?? (!['todos', 'sin'].includes(estado.filtroResp) ? estado.filtroResp : '');

  const actual = t?.estado ?? 'pendiente';
  $('#seg-estado').innerHTML = ESTADOS.map(e =>
    `<label><input type="radio" name="estado" value="${e.id}" ${e.id === actual ? 'checked' : ''}><span>${e.icono} ${e.nombre}</span></label>`).join('');

  edicion = { ticket: t, fotos: [...(t?.fotos ?? [])], nuevas: new Set(), originales: [...(t?.fotos ?? [])] };
  pintarFotosForm();
  $('#dlg-ver').close();
  $('#dlg-editar').showModal();
  if (!t) setTimeout(() => f.cliente.focus(), 50);
}

function pintarFotosForm() {
  $('#fotos-previas').innerHTML = edicion.fotos.map((ruta, i) =>
    `<div class="previa" style="background-image:url('${esc(estado.urls[ruta] || '')}')">
       <button type="button" data-quitar-foto="${i}" aria-label="Quitar foto">✕</button>
     </div>`).join('');
}

async function agregarFotos(files) {
  const imgs = [...files].filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  if (!imgs.length) return;
  const btn = $('#btn-guardar-ticket');
  btn.disabled = true;
  const zona = $('#zona-fotos');
  zona.classList.add('subiendo');
  const ed = edicion;
  try {
    for (const file of imgs) {
      const ruta = await estado.api.uploadFoto(file);
      if (edicion !== ed) { estado.api.removeFotos([ruta]).catch(() => {}); return; } // se cerró el formulario a medio subir
      edicion.fotos.push(ruta);
      edicion.nuevas.add(ruta);
      Object.assign(estado.urls, await estado.api.fotoUrls([ruta]));
      pintarFotosForm();
    }
  } catch (e) {
    toast('No se pudo subir la foto: ' + mensajeError(e), 'error');
  } finally {
    btn.disabled = false;
    zona.classList.remove('subiendo');
  }
}

async function guardarTicket(ev) {
  ev.preventDefault();
  if ($('#zona-fotos').classList.contains('subiendo')) return toast('Espera a que termine de subir la foto');
  const f = form();
  const datos = {
    cliente: f.cliente.value.trim(),
    telefono: f.telefono.value.trim() || null,
    trabajo: f.trabajo.value.trim(),
    instrucciones: f.instrucciones.value.trim(),
    fecha_inicio: f.fecha_inicio.value,
    fecha_entrega: f.fecha_entrega.value,
    responsable_id: f.responsable_id.value || null,
    estado: f.estado.value,
    prioridad: f.urgente.checked ? 'urgente' : 'normal',
    fotos: edicion.fotos,
  };
  const err = $('#ticket-error');
  if (datos.fecha_entrega < datos.fecha_inicio) {
    err.textContent = 'La fecha de entrega no puede ser antes de la de inicio.';
    err.hidden = false;
    return;
  }
  const btn = $('#btn-guardar-ticket');
  btn.disabled = true;
  try {
    const guardado = await estado.api.saveTicket({ id: edicion.ticket?.id, ...datos });
    const quitadas = edicion.originales.filter(r => !edicion.fotos.includes(r));
    estado.api.removeFotos(quitadas).catch(() => {});
    edicion.nuevas.clear();
    $('#dlg-editar').close();
    toast(edicion.ticket ? 'Ticket actualizado' : `Ticket #${guardado.folio} creado`, 'ok');
    await recargar();
  } catch (e) {
    err.textContent = mensajeError(e);
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

async function borrarTicket() {
  const t = edicion?.ticket;
  if (!t || !confirm(`¿Borrar el ticket #${t.folio} de ${t.cliente}? No se puede deshacer.`)) return;
  try {
    await estado.api.deleteTicket(t);
    $('#dlg-editar').close();
    toast('Ticket borrado');
    await recargar();
  } catch (e) {
    toast(mensajeError(e), 'error');
  }
}

/* Si se cancela, las fotos recién subidas no se quedan huérfanas. */
function alCerrarEditar() {
  if (edicion?.nuevas.size) estado.api.removeFotos([...edicion.nuevas]).catch(() => {});
  edicion = null;
}

/* ------------------------------------------------------------------
   Ajustes: responsables
   ------------------------------------------------------------------ */
let colorNuevo = null; // null = el primer color que nadie usa
const colorLibre = () => PALETA.find(c => !estado.responsables.some(r => r.color === c)) ?? PALETA[estado.responsables.length % PALETA.length];

function paletaHTML(sel, attr) {
  return PALETA.map(c => `<button type="button" class="muestra ${c === sel ? 'sel' : ''}" style="--c:${c}" ${attr}="${c}" aria-label="Color ${c}"></button>`).join('');
}

function pintarAjustes() {
  const activos = estado.tickets.filter(t => t.estado !== 'entregado');
  $('#lista-resp').innerHTML = estado.responsables.map(r => `
    <li class="${r.activo ? '' : 'inactivo'}" data-resp="${r.id}">
      ${avatar(r, true)}
      <div class="resp-datos">
        <input class="resp-nombre" value="${esc(r.nombre)}" data-campo="nombre" aria-label="Nombre">
        <div class="paleta">${paletaHTML(r.color, 'data-color')}</div>
      </div>
      <span class="resp-cuenta">${((n) => `${n} ${n === 1 ? 'trabajo activo' : 'trabajos activos'}`)(activos.filter(t => t.responsable_id === r.id).length)}</span>
      <label class="switch" title="${r.activo ? 'Activo' : 'Inactivo'}"><input type="checkbox" data-campo="activo" ${r.activo ? 'checked' : ''}><span></span></label>
      <button class="btn btn-icono peligro" data-borrar-resp title="Eliminar">🗑</button>
    </li>`).join('') || '<li class="vacio-col">Aún no hay responsables. Agrega el primero abajo.</li>';
  $('#paleta-nuevo').innerHTML = paletaHTML(colorNuevo ?? colorLibre(), 'data-color-nuevo');

  const s = estado.sesion?.user?.email;
  $('#info-sesion').textContent = estado.api.modo === 'demo'
    ? 'Estás en modo demo: los cambios viven solo en esta pestaña y se pierden al recargar.'
    : `Sesión iniciada como ${s ?? '—'}.`;
}

async function guardarResp(id, patch) {
  try {
    await estado.api.saveResponsable({ id, ...patch });
    await recargar();
  } catch (e) {
    toast(mensajeError(e), 'error');
  }
}

/* ------------------------------------------------------------------
   Imprimir
   ------------------------------------------------------------------ */
async function imprimir(id) {
  const t = estado.tickets.find(x => x.id === id);
  const r = responsable(t.responsable_id);
  const fotos = (t.fotos ?? []).map(f => estado.urls[f]).filter(Boolean);
  const hoja = $('#hoja-impresion');
  hoja.innerHTML = `
    <div class="imp-cabeza"><h1>Ticket #${t.folio}</h1><span>${t.prioridad === 'urgente' ? 'URGENTE · ' : ''}${esc(APP_NAME)}</span></div>
    <h2>${esc(t.trabajo)}</h2>
    <table>
      <tr><th>Cliente</th><td>${esc(t.cliente)}${t.telefono ? ' · ' + esc(t.telefono) : ''}</td></tr>
      <tr><th>Inicio</th><td>${fmtLarga(t.fecha_inicio)}</td></tr>
      <tr><th>Entrega</th><td><b>${fmtLarga(t.fecha_entrega)}</b></td></tr>
      <tr><th>Responsable</th><td>${r ? esc(r.nombre) : 'Sin asignar'}</td></tr>
    </table>
    <h3>Instrucciones</h3>
    <p class="imp-instr">${esc(t.instrucciones)}</p>
    ${fotos.map(f => `<img src="${esc(f)}" alt="">`).join('')}`;
  await Promise.all($$('img', hoja).map(img => img.decode().catch(() => {})));
  window.print();
}

/* ------------------------------------------------------------------
   Eventos
   ------------------------------------------------------------------ */
function conectarEventos() {
  document.addEventListener('click', async (ev) => {
    const el = ev.target;

    if (el.closest('[data-cerrar]')) return el.closest('dialog').close();

    const accion = el.closest('[data-accion]')?.dataset.accion;
    if (accion === 'nuevo') return abrirEditar();
    if (accion === 'ajustes') { pintarAjustes(); return $('#dlg-ajustes').showModal(); }
    if (accion === 'salir') {
      await estado.api?.auth.signOut();
      setDemo(false);
      return location.reload();
    }
    if (accion === 'cambiar-conexion') {
      if (!confirm('¿Desconectar este dispositivo de la base de datos actual?')) return;
      await estado.api?.auth.signOut().catch(() => {});
      setDemo(false);
      clearConnection();
      return location.reload();
    }

    const avanzar = el.closest('[data-avanzar]');
    if (avanzar) return cambiarEstado(avanzar.closest('.ticket').dataset.id, avanzar.dataset.avanzar);

    const kpi = el.closest('[data-foco]');
    if (kpi) {
      const f = kpi.dataset.foco || null;
      estado.foco = estado.foco === f ? null : f;
      return pintar();
    }

    const vista = el.closest('[data-vista]');
    if (vista) {
      estado.vista = vista.dataset.vista;
      localStorage.setItem(LS_KEYS.vista, estado.vista);
      pintarVista();
      return pintarTablero();
    }

    const filtro = el.closest('[data-filtro]');
    if (filtro) {
      estado.filtroResp = filtro.dataset.filtro;
      localStorage.setItem(LS_KEYS.filtro, estado.filtroResp);
      return pintar();
    }

    const card = el.closest('.ticket');
    if (card) return abrirVer(card.dataset.id);

    const paso = el.closest('[data-estado-ver]');
    if (paso) return cambiarEstado($('#dlg-ver').dataset.id, paso.dataset.estadoVer);
    if (el.closest('[data-editar]')) return abrirEditar(el.closest('[data-editar]').dataset.editar);
    if (el.closest('[data-imprimir]')) return imprimir($('#dlg-ver').dataset.id);
    if (el.matches('[data-mini]')) {
      $('.foto-principal').src = el.src;
      $$('[data-mini]').forEach(m => m.classList.toggle('activa', m === el));
      return;
    }
    if (el.matches('[data-zoom]')) {
      $('#visor img').src = el.src;
      return ($('#visor').hidden = false);
    }
    if (el.closest('#visor')) return ($('#visor').hidden = true);

    const quitar = el.closest('[data-quitar-foto]');
    if (quitar) {
      edicion.fotos.splice(Number(quitar.dataset.quitarFoto), 1);
      return pintarFotosForm();
    }

    if (el.matches('[data-color-nuevo]')) { colorNuevo = el.dataset.colorNuevo; return pintarAjustes(); }
    const li = el.closest('[data-resp]');
    if (li && el.matches('[data-color]')) return guardarResp(li.dataset.resp, { color: el.dataset.color });
    if (li && el.closest('[data-borrar-resp]')) {
      const r = responsable(li.dataset.resp);
      const n = estado.tickets.filter(t => t.responsable_id === r.id).length;
      const aviso = n ? `\n\n${n} ticket(s) quedarán "Sin asignar". Si solo ya no trabaja aquí, mejor desactívalo.` : '';
      if (!confirm(`¿Eliminar a ${r.nombre}?${aviso}`)) return;
      try { await estado.api.deleteResponsable(r.id); await recargar(); } catch (e) { toast(mensajeError(e), 'error'); }
    }
  });

  // Teclado: Enter abre la tarjeta enfocada
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.matches('.ticket')) abrirVer(ev.target.dataset.id);
    if (ev.key === 'Escape') $('#visor').hidden = true;
  });

  // Cambios en ajustes (nombre y activo)
  $('#lista-resp').addEventListener('change', (ev) => {
    const li = ev.target.closest('[data-resp]');
    const campo = ev.target.dataset.campo;
    if (!li || !campo) return;
    if (campo === 'nombre') {
      const v = ev.target.value.trim();
      if (!v) return pintarAjustes();
      return guardarResp(li.dataset.resp, { nombre: v });
    }
    if (campo === 'activo') guardarResp(li.dataset.resp, { activo: ev.target.checked });
  });

  $('#form-resp').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nombre = ev.target.nombre.value.trim();
    if (!nombre) return;
    await guardarResp(null, { nombre, color: colorNuevo ?? colorLibre(), activo: true });
    ev.target.reset();
    colorNuevo = null;
    pintarAjustes();
    ev.target.nombre.focus();
  });

  $('#buscar').addEventListener('input', (ev) => { estado.busqueda = ev.target.value; pintarTablero(); });

  form().addEventListener('submit', guardarTicket);
  $('#btn-borrar-ticket').addEventListener('click', borrarTicket);
  $('#dlg-editar').addEventListener('close', alCerrarEditar);
  $('#input-fotos').addEventListener('change', (ev) => { agregarFotos(ev.target.files); ev.target.value = ''; });
  form().fecha_inicio.addEventListener('change', (ev) => { form().fecha_entrega.min = ev.target.value; });

  // Arrastrar fotos al formulario
  const zona = $('#zona-fotos');
  zona.addEventListener('dragover', (ev) => { ev.preventDefault(); zona.classList.add('encima'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
  zona.addEventListener('drop', (ev) => { ev.preventDefault(); zona.classList.remove('encima'); agregarFotos(ev.dataTransfer.files); });

  // Pegar una captura con Ctrl+V dentro del formulario
  $('#dlg-editar').addEventListener('paste', (ev) => {
    const files = [...ev.clipboardData.files];
    if (files.length) { ev.preventDefault(); agregarFotos(files); }
  });

  // Arrastrar tarjetas entre columnas
  const tablero = $('#tablero');
  tablero.addEventListener('dragstart', (ev) => {
    const card = ev.target.closest('.ticket');
    if (!card) return;
    ev.dataTransfer.setData('text/plain', card.dataset.id);
    ev.dataTransfer.effectAllowed = 'move';
    card.classList.add('arrastrando');
  });
  tablero.addEventListener('dragend', () => $$('.arrastrando, .col-encima').forEach(e => e.classList.remove('arrastrando', 'col-encima')));
  tablero.addEventListener('dragover', (ev) => {
    const col = ev.target.closest('.columna');
    if (!col) return;
    ev.preventDefault();
    $$('.col-encima').forEach(c => c !== col && c.classList.remove('col-encima'));
    col.classList.add('col-encima');
  });
  tablero.addEventListener('drop', (ev) => {
    const col = ev.target.closest('.columna');
    if (!col) return;
    ev.preventDefault();
    col.classList.remove('col-encima');
    cambiarEstado(ev.dataTransfer.getData('text/plain'), col.dataset.estado);
  });

  // Cerrar diálogos tocando fuera
  $$('dialog').forEach(d => d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); }));

  // Los "vence hoy / mañana" cambian a medianoche y al volver a la pestaña
  document.addEventListener('visibilitychange', () => { if (!document.hidden && estado.sesion) recargar(); });
}

/* ------------------------------------------------------------------
   Arranque
   ------------------------------------------------------------------ */
async function entrarApp(sesion) {
  estado.sesion = sesion;
  $('#chip-demo').hidden = estado.api.modo !== 'demo';
  $('#app-titulo').textContent = APP_NAME;
  mostrar('app');
  await recargar();
  estado.api.subscribe(recargarPronto);
}

async function arrancar() {
  // Con la conexión fija en config.js no hay nada que cambiar desde la app.
  if (getConnection()?.fija) $$('[data-accion="cambiar-conexion"]').forEach(b => (b.hidden = true));
  try {
    estado.api = createApi();
  } catch (e) {
    toast(mensajeError(e), 'error');
    return mostrar('conexion');
  }
  if (!estado.api) return mostrar('conexion');

  const sesion = await estado.api.auth.session().catch(() => null);
  if (sesion) return entrarApp(sesion);
  mostrar('login');
}

$('#form-conexion').addEventListener('submit', (ev) => {
  ev.preventDefault();
  saveConnection(ev.target.url.value, ev.target.key.value);
  setDemo(false);
  arrancar();
});
$('#btn-demo').addEventListener('click', () => { setDemo(true); arrancar(); });

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = $('#login-error');
  err.hidden = true;
  const btn = ev.target.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const { session } = await estado.api.auth.signIn(ev.target.email.value, ev.target.password.value);
    await entrarApp(session);
  } catch (e) {
    err.textContent = mensajeError(e);
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

conectarEventos();
arrancar();
if (isDemo()) document.title += ' · demo';
