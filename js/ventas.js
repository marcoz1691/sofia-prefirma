// Tablero de prospectos de SOFIA PreFirma (sofiaprefirma.com/ventas/). Independiente del panel de una notaría.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ETAPAS = [["nuevo", "Nuevo"], ["contactado", "Contactado"], ["demostracion", "Demostración"], ["propuesta", "Propuesta"], ["ganado", "Ganado"], ["perdido", "Perdido"]];
const CONTRATOS = [["no_enviado", "No enviado"], ["enviado", "Enviado"], ["firmado", "Firmado"]];
const PAGOS = [["pendiente", "Pendiente"], ["pagado", "Pagado"]];
const MOTIVOS = { demostracion: "Demostración", cotizacion: "Cotización", contratar: "Quiere contratar", asesor: "Hablar con asesor", soporte: "Soporte" };
const CERRADAS = ["ganado", "perdido"];
const REFRESCO_MS = 60 * 1000;
const TRADUCCION = { "Invalid login credentials": "Correo o contraseña incorrectos.", "Email not confirmed": "Tu correo aún no está confirmado.",
  "Invalid TOTP code entered": "El código no es correcto. Revisa la hora de tu celular y vuelve a intentar." };
const traducir = (m) => TRADUCCION[m] || m || "Algo salió mal. Intenta de nuevo.";
const dinero = (n) => new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(new Date());
const fechaCorta = (iso) => iso ? new Date(iso).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "2-digit", timeZone: "America/Guayaquil" }) : "";

let datos = [], planes = [], ultimaCarga = 0, timer = null;
const filtros = { etapa: "", contrato: "", q: "", vencidos: false, kpi: "" };
const orden = { campo: "creado", dir: -1 };
const abiertos = new Set();

const cfg = await fetch("/api/prospectos?accion=config").then((r) => r.ok ? r.json() : null).catch(() => null);
if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey || !window.supabase) {
  $("#cargando").textContent = "No pudimos abrir el tablero. Recarga la página en unos minutos.";
  throw new Error("Sin configuración del tablero");
}
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, storageKey: "sofia-ventas-sesion" } });

function vista(id) {
  $("#cargando").hidden = true;
  $("#acceso").hidden = !id;
  $("#tablero").hidden = !!id;
  for (const f of document.querySelectorAll("[data-vista]")) f.hidden = f.id !== id;
  $("#salir").hidden = $("#quien").hidden = !!id;
  if (id) setTimeout(() => $(`#${id} input`)?.focus(), 0);
}

function avisar(texto, error = false) {
  const a = $("#aviso");
  a.textContent = texto;
  a.classList.toggle("es-error", error);
  a.classList.add("ver");
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => a.classList.remove("ver"), error ? 5000 : 1800);
}

async function api(metodo, cuerpo) {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) { vista("vEntrar"); throw new Error("Inicia sesión"); }
  const r = await fetch(metodo === "GET" ? "/api/prospectos?accion=lista" : "/api/prospectos", {
    method: metodo, headers: { Authorization: "Bearer " + token, ...(cuerpo && { "Content-Type": "application/json" }) }, body: cuerpo && JSON.stringify(cuerpo) });
  const res = await r.json().catch(() => ({}));
  if (r.status === 401) { if (res.mfa) await pasoMfa(); else vista("vEntrar"); throw new Error(res.error || "Inicia sesión"); }
  if (!r.ok) throw new Error(res.error || "No se pudo completar la acción.");
  return res;
}

/* ---------- Acceso ---------- */
let factorMfa = null;
async function pasoMfa() {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  const verificado = (data.totp || []).find((f) => f.status === "verified");
  if (verificado) { factorMfa = verificado.id; vista("vMfaCodigo"); return; }
  for (const f of data.all || []) if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
  const alta = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Tablero SOFIA PreFirma" });
  if (alta.error) throw alta.error;
  factorMfa = alta.data.id;
  $("#mfaQr").src = alta.data.totp.qr_code;
  $("#mfaClave").textContent = alta.data.totp.secret;
  vista("vMfaAlta");
}

async function continuar() {
  if (cfg.mfa) {
    const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel !== "aal2") return pasoMfa();
  }
  await cargar(true);
}

function ocupado(form, fn) {
  const b = form.querySelector("button[type=submit]");
  b.disabled = true;
  return fn().finally(() => { b.disabled = false; });
}

$("#vEntrar").addEventListener("submit", (e) => {
  e.preventDefault();
  ocupado(e.target, async () => {
    $("#mEntrar").textContent = "";
    const { error } = await sb.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#clave").value });
    if (error) { $("#mEntrar").textContent = traducir(error.message); return; }
    try { await continuar(); } catch (err) { $("#mEntrar").textContent = traducir(err.message); }
  });
});
for (const [form, campo, msg] of [["#vMfaCodigo", "#mfaCodigo", "#mMfaCodigo"], ["#vMfaAlta", "#mfaCodigoAlta", "#mMfaAlta"]]) {
  $(form).addEventListener("submit", (e) => {
    e.preventDefault();
    ocupado(e.target, async () => {
      $(msg).textContent = "";
      const code = $(campo).value.replace(/\D/g, "");
      if (code.length !== 6) { $(msg).textContent = "Escribe los 6 dígitos."; return; }
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factorMfa, code });
      if (error) { $(msg).textContent = traducir(error.message); return; }
      try { await cargar(true); } catch (err) { $(msg).textContent = traducir(err.message); }
    });
  });
}
$("#salir").addEventListener("click", async () => { clearInterval(timer); await sb.auth.signOut(); datos = []; vista("vEntrar"); });

/* ---------- Datos ---------- */
const precioPlan = (nombre) => planes.find((p) => p.nombre.toLowerCase() === String(nombre || "").toLowerCase())?.mensual ?? null;
const valorDe = (p) => p.valorMensual ?? precioPlan(p.plan) ?? 0;
const vencido = (p) => !!p.proximoEn && p.proximoEn < hoy() && !CERRADAS.includes(p.etapa);
const editando = () => !!document.activeElement?.closest?.("#filas, dialog[open]");

async function cargar(primera = false) {
  const r = await api("GET");
  datos = r.prospectos || [];
  planes = r.planes || [];
  ultimaCarga = Date.now();
  if (primera) {
    $("#quien").textContent = r.email || "";
    $("#planesLista").innerHTML = planes.map((p) => `<option value="${esc(p.nombre)}">`).join("");
    vista(null);
    clearInterval(timer);
    timer = setInterval(refrescar, REFRESCO_MS);
  }
  render();
}

async function refrescar() {
  if (document.hidden || editando() || $("#acceso").hidden === false) return;
  try { await cargar(); } catch {}
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - ultimaCarga > REFRESCO_MS) refrescar(); });
setInterval(() => {
  if (!ultimaCarga) return;
  const s = Math.round((Date.now() - ultimaCarga) / 1000);
  $("#actualizado").textContent = s < 10 ? "Actualizado ahora" : s < 60 ? `Actualizado hace ${s} s` : `Actualizado hace ${Math.round(s / 60)} min`;
}, 5000);

/* ---------- Filtros y resumen ---------- */
function coincide(p, sinEtapa = false) {
  if (!sinEtapa && filtros.etapa && p.etapa !== filtros.etapa) return false;
  if (filtros.contrato && p.contrato !== filtros.contrato) return false;
  if (filtros.vencidos && !vencido(p)) return false;
  if (filtros.kpi === "abiertos" && CERRADAS.includes(p.etapa)) return false;
  if (filtros.q) {
    const texto = [p.nombre, p.notaria, p.ciudad, p.cargo, p.telefono, p.correo, p.plan, p.notas, p.proximoPaso].join(" ").toLowerCase();
    if (!filtros.q.split(/\s+/).every((t) => texto.includes(t))) return false;
  }
  return true;
}

function ordenar(lista) {
  const pos = (arr, v) => arr.findIndex(([k]) => k === v);
  const clave = { creado: (p) => p.creado || "", nombre: (p) => (p.nombre || "").toLowerCase(), plan: (p) => (p.plan || "").toLowerCase(),
    etapa: (p) => pos(ETAPAS, p.etapa), contrato: (p) => pos(CONTRATOS, p.contrato), pago: (p) => pos(PAGOS, p.pago), valor: valorDe,
    proximoEn: (p) => p.proximoEn || (orden.dir > 0 ? "9999" : "") }[orden.campo];
  return [...lista].sort((a, b) => { const x = clave(a), y = clave(b); return (x > y ? 1 : x < y ? -1 : 0) * orden.dir; });
}

function renderResumen() {
  const abiertos = datos.filter((p) => !CERRADAS.includes(p.etapa));
  const firmados = datos.filter((p) => p.contrato === "firmado" && p.etapa !== "perdido");
  const kpis = [
    { id: "abiertos", titulo: "En curso", valor: abiertos.length, nota: `${datos.length} en total` },
    { id: "nuevo", titulo: "Por contactar", valor: datos.filter((p) => p.etapa === "nuevo").length, nota: "etapa Nuevo" },
    { id: "enviado", titulo: "Contrato enviado", valor: datos.filter((p) => p.contrato === "enviado").length, nota: "esperando firma" },
    { id: "firmado", titulo: "Contratos firmados", valor: firmados.length, nota: `${firmados.filter((p) => p.pago === "pagado").length} con pago al día` },
    { id: "", titulo: "Ingreso mensual firmado", valor: dinero(firmados.reduce((s, p) => s + valorDe(p), 0)), nota: `${dinero(abiertos.reduce((s, p) => s + valorDe(p), 0))} en negociación`, dinero: true }
  ];
  $("#kpis").innerHTML = kpis.map((k) => `<button type="button" class="kpi${k.dinero ? " kpi--dinero" : ""}" data-kpi="${k.id}" aria-pressed="${!!k.id && filtros.kpi === k.id}">
    <span>${esc(k.titulo)}</span><strong>${esc(k.valor)}</strong><small>${esc(k.nota)}</small></button>`).join("");
  const conteo = (e) => datos.filter((p) => coincide(p, true) && (!e || p.etapa === e)).length;
  $("#etapas").innerHTML = [["", "Todas"], ...ETAPAS].map(([k, t]) =>
    `<button type="button" data-etapa="${k}" aria-pressed="${filtros.etapa === k}">${esc(t)} <b>${conteo(k)}</b></button>`).join("");
}

const opciones = (lista, actual) => lista.map(([k, t]) => `<option value="${k}"${k === actual ? " selected" : ""}>${t}</option>`).join("");

function filaHtml(p) {
  const tel = String(p.telefono || "").replace(/\D/g, "");
  const wa = tel.length < 7 ? "" : tel.startsWith("0") ? "593" + tel.slice(1) : tel.length === 9 && tel.startsWith("9") ? "593" + tel : tel;
  const sugerido = precioPlan(p.plan);
  const clases = ["fila", vencido(p) && "es-vencido", p.etapa === "perdido" && "es-perdido"].filter(Boolean).join(" ");
  const abierta = abiertos.has(p.id);
  return `<tr class="${clases}" data-id="${esc(p.id)}">
    <td data-etiqueta="Fecha"><div><time datetime="${esc(p.creado)}">${esc(fechaCorta(p.creado))}</time><small>${esc(MOTIVOS[p.motivo] || p.motivo || "")}</small></div></td>
    <td data-etiqueta="Cliente"><div><b>${esc(p.nombre)}</b><small>${esc([p.cargo, [p.notaria, p.ciudad].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "—")}</small></div></td>
    <td data-etiqueta="Contacto" class="contacto"><div>${wa ? `<a href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">WhatsApp ${esc(p.telefono)}</a>` : ""}${p.correo ? `<a href="mailto:${esc(p.correo)}">${esc(p.correo)}</a>` : ""}${!wa && !p.correo ? "—" : ""}</div></td>
    <td data-etiqueta="Plan"><input class="campo" data-campo="plan" list="planesLista" value="${esc(p.plan)}" aria-label="Plan de ${esc(p.nombre)}" maxlength="40"></td>
    <td data-etiqueta="Etapa"><select class="pastilla etapa--${esc(p.etapa)}" data-campo="etapa" aria-label="Etapa de ${esc(p.nombre)}">${opciones(ETAPAS, p.etapa)}</select></td>
    <td data-etiqueta="Contrato"><div><select class="pastilla contrato--${esc(p.contrato)}" data-campo="contrato" aria-label="Contrato de ${esc(p.nombre)}">${opciones(CONTRATOS, p.contrato)}</select>${p.contrato === "firmado" ? `<input class="campo campo--fecha firmado-en" type="date" data-campo="firmadoEn" value="${esc(p.firmadoEn || "")}" aria-label="Fecha de firma de ${esc(p.nombre)}">` : ""}</div></td>
    <td data-etiqueta="Pago"><select class="pastilla pago--${esc(p.pago)}" data-campo="pago" aria-label="Pago de ${esc(p.nombre)}">${opciones(PAGOS, p.pago)}</select></td>
    <td data-etiqueta="Valor / mes"><input class="campo campo--num" type="number" min="0" step="0.01" inputmode="decimal" data-campo="valorMensual" value="${p.valorMensual ?? ""}" placeholder="${sugerido ?? ""}" aria-label="Valor mensual de ${esc(p.nombre)}"></td>
    <td data-etiqueta="Seguimiento"><div class="seguimiento"><input class="campo" data-campo="proximoPaso" value="${esc(p.proximoPaso)}" placeholder="Próximo paso…" maxlength="200" aria-label="Próximo paso con ${esc(p.nombre)}"><input class="campo campo--fecha" type="date" data-campo="proximoEn" value="${esc(p.proximoEn || "")}" aria-label="Fecha de seguimiento de ${esc(p.nombre)}"></div></td>
    <td><button type="button" class="mas" data-abrir aria-expanded="${abierta}"${p.notas ? " data-notas" : ""}>Notas</button></td>
  </tr>
  <tr class="detalle" data-detalle="${esc(p.id)}"${abierta ? "" : " hidden"}><td colspan="10"><div class="detalle__caja">
    <div><h3>Lo que pidió</h3><p>${esc(p.detalle || "—")}</p>${p.actualizadoPor ? `<h3 class="detalle__edicion">Última edición</h3><p>${esc(p.actualizadoPor)} · ${esc(fechaCorta(p.actualizado))}</p>` : ""}</div>
    <label><h3>Notas internas</h3><textarea class="campo" data-campo="notas" maxlength="2000" placeholder="Llamadas, acuerdos, objeciones…">${esc(p.notas)}</textarea></label>
  </div></td></tr>`;
}

const idDe = (el) => el.closest("[data-id]")?.dataset.id ?? el.closest("[data-detalle]")?.dataset.detalle;

function render() {
  // Al redibujar se conserva lo que la persona esté escribiendo en otra celda mientras se guarda un cambio.
  const el = document.activeElement;
  const foco = el?.dataset?.campo && el.closest("#filas") ? { id: idDe(el), campo: el.dataset.campo, valor: el.value, sel: el.selectionStart } : null;
  renderResumen();
  const lista = ordenar(datos.filter((p) => coincide(p)));
  $("#filas").innerHTML = lista.map(filaHtml).join("");
  $("#vacio").hidden = lista.length > 0;
  for (const b of document.querySelectorAll("[data-orden]")) {
    if (b.dataset.orden === orden.campo) b.dataset.dir = String(orden.dir); else delete b.dataset.dir;
  }
  if (!foco?.id) return;
  const id = CSS.escape(foco.id);
  const nuevo = document.querySelector(`[data-id="${id}"] [data-campo="${foco.campo}"], [data-detalle="${id}"] [data-campo="${foco.campo}"]`);
  if (!nuevo) return;
  if (nuevo.value !== foco.valor) nuevo.value = foco.valor;
  nuevo.focus();
  if (typeof foco.sel === "number" && nuevo.setSelectionRange) try { nuevo.setSelectionRange(foco.sel, foco.sel); } catch {}
}

/* ---------- Edición en línea ---------- */
async function guardar(id, cambios) {
  const p = datos.find((x) => x.id === id);
  if (!p) return;
  const antes = { ...p };
  Object.assign(p, cambios);
  const fila = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
  fila?.classList.add("es-guardando");
  try {
    const r = await api("POST", { accion: "actualizar", id, cambios });
    Object.assign(p, r.prospecto);
    render();
    document.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.add("es-guardado");
    avisar(cambios.contrato === "firmado" ? "Contrato firmado: prospecto ganado" : "Guardado");
  } catch (e) {
    Object.assign(p, antes);
    render();
    avisar(e.message, true);
  }
}

function valorCampo(el) {
  const v = el.value;
  if (el.dataset.campo === "valorMensual") return v === "" ? null : Number(v);
  if (el.type === "date") return v || null;
  return v.trim();
}

$("#filas").addEventListener("change", (e) => {
  const el = e.target.closest("[data-campo]");
  if (!el) return;
  const id = idDe(el);
  const p = datos.find((x) => x.id === id);
  const valor = valorCampo(el);
  if (!p || (p[el.dataset.campo] ?? null) === valor || (p[el.dataset.campo] ?? "") === valor) return;
  guardar(id, { [el.dataset.campo]: valor });
});
$("#filas").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input.campo")) e.target.blur(); });
$("#filas").addEventListener("click", (e) => {
  const b = e.target.closest("[data-abrir]");
  if (!b) return;
  const id = b.closest("[data-id]").dataset.id;
  const abierta = !abiertos.has(id);
  abierta ? abiertos.add(id) : abiertos.delete(id);
  b.setAttribute("aria-expanded", abierta);
  const d = document.querySelector(`[data-detalle="${CSS.escape(id)}"]`);
  d.hidden = !abierta;
  if (abierta) d.querySelector("textarea")?.focus();
});

/* ---------- Filtros ---------- */
$("#kpis").addEventListener("click", (e) => {
  const k = e.target.closest("[data-kpi]")?.dataset.kpi;
  if (k === undefined || k === "") return;
  const activo = filtros.kpi === k || filtros.etapa === k || filtros.contrato === k;
  Object.assign(filtros, { kpi: "", etapa: "", contrato: "" });
  if (!activo) {
    if (k === "abiertos") filtros.kpi = k;
    else if (k === "nuevo") { filtros.etapa = k; filtros.kpi = k; }
    else { filtros.contrato = k; filtros.kpi = k; }
  }
  $("#fContrato").value = filtros.contrato;
  render();
});
$("#etapas").addEventListener("click", (e) => {
  const b = e.target.closest("[data-etapa]");
  if (!b) return;
  filtros.etapa = b.dataset.etapa;
  filtros.kpi = "";
  render();
});
let espera;
$("#buscar").addEventListener("input", (e) => { clearTimeout(espera); espera = setTimeout(() => { filtros.q = e.target.value.trim().toLowerCase(); render(); }, 120); });
$("#fContrato").addEventListener("change", (e) => { filtros.contrato = e.target.value; filtros.kpi = ""; render(); });
$("#fVencidos").addEventListener("change", (e) => { filtros.vencidos = e.target.checked; render(); });
document.querySelector(".tabla thead").addEventListener("click", (e) => {
  const b = e.target.closest("[data-orden]");
  if (!b) return;
  orden.dir = orden.campo === b.dataset.orden ? -orden.dir : (b.dataset.orden === "nombre" || b.dataset.orden === "proximoEn" ? 1 : -1);
  orden.campo = b.dataset.orden;
  render();
});

/* ---------- Agregar y exportar ---------- */
const dialogo = $("#dNuevo");
$("#agregar").addEventListener("click", () => { $("#fNuevo").reset(); $("#mNuevo").textContent = ""; dialogo.showModal(); });
$("#cancelarNuevo").addEventListener("click", () => dialogo.close());
$("#fNuevo").addEventListener("submit", (e) => {
  e.preventDefault();
  ocupado(e.target, async () => {
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api("POST", { accion: "crear", ...f });
      datos.unshift(r.prospecto);
      Object.assign(filtros, { etapa: "", contrato: "", kpi: "", vencidos: false });
      $("#fContrato").value = ""; $("#fVencidos").checked = false;
      dialogo.close();
      render();
      avisar("Prospecto agregado");
    } catch (err) { $("#mNuevo").textContent = err.message; }
  });
});

$("#exportar").addEventListener("click", () => {
  const nombre = (lista, k) => lista.find(([x]) => x === k)?.[1] || k;
  const columnas = [["Fecha", (p) => (p.creado || "").slice(0, 10)], ["Nombre", (p) => p.nombre], ["Cargo", (p) => p.cargo], ["Notaría", (p) => p.notaria],
    ["Ciudad", (p) => p.ciudad], ["Teléfono", (p) => p.telefono], ["Correo", (p) => p.correo], ["Plan", (p) => p.plan], ["Motivo", (p) => MOTIVOS[p.motivo] || p.motivo],
    ["Etapa", (p) => nombre(ETAPAS, p.etapa)], ["Contrato", (p) => nombre(CONTRATOS, p.contrato)], ["Firmado el", (p) => p.firmadoEn || ""],
    ["Pago", (p) => nombre(PAGOS, p.pago)], ["Valor mensual", (p) => valorDe(p)], ["Próximo paso", (p) => p.proximoPaso], ["Seguimiento", (p) => p.proximoEn || ""],
    ["Notas", (p) => p.notas], ["Detalle", (p) => p.detalle]];
  const celda = (v) => { const s = String(v ?? ""); return /^[=+\-@]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : `"${s.replace(/"/g, '""')}"`; };
  const csv = [columnas.map(([t]) => celda(t)).join(";"), ...ordenar(datos.filter((p) => coincide(p))).map((p) => columnas.map(([, fn]) => celda(fn(p))).join(";"))].join("\r\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })), download: `prospectos-${hoy()}.csv` });
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ---------- Arranque ---------- */
const { data: { session } } = await sb.auth.getSession();
if (session) {
  try { await continuar(); }
  catch (e) { if ($("#acceso").hidden || !$("#vEntrar").hidden) { vista("vEntrar"); $("#mEntrar").textContent = traducir(e.message); } }
}
else vista("vEntrar");
