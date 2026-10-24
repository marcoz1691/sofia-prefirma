// Fila virtual: el cliente toma su número, ve cuántas personas tiene delante y recibe el aviso cuando lo llaman.
import { montarAceptacion, banderasAceptacion } from "./aceptacion.js";

const $ = (s) => document.querySelector(s);
const CLAVE = "n41-turno";
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const form = $("#form-turno"), error = $("#turno-error");
const aceptacion = montarAceptacion($("#turno-enviar"), "aceptacion");
let codigo = null, temporizador = null, avisado = false;

function leer() { try { const t = JSON.parse(localStorage.getItem(CLAVE)); return t?.fecha === hoy() && /^[0-9a-f]{24}$/.test(t.codigo) ? t.codigo : null; } catch (e) { return null; } }
function guardar(c) { try { localStorage.setItem(CLAVE, JSON.stringify({ codigo: c, fecha: hoy() })); } catch (e) {} }
function olvidar() { try { localStorage.removeItem(CLAVE); } catch (e) {} }
function mostrar(id) {
  const cambia = $(id).hidden;
  for (const s of ["#tomar", "#ticket", "#apagado"]) $(s).hidden = s !== id;
  if (cambia) window.scrollTo(0, 0);
}
function apagado(texto) { $("#apagado-texto").textContent = texto || "Acércate a recepción y te atenderemos por orden de llegada."; mostrar("#apagado"); }

function pintar(t) {
  mostrar("#ticket");
  $("#ticket-numero").textContent = t.numero;
  const llamado = t.estado === "llamado", terminado = ["atendido", "ausente", "cancelado"].includes(t.estado);
  document.body.classList.toggle("turno--llamado", llamado);
  $("#ticket-estado").textContent = llamado ? `¡Te toca! Acércate a la ventanilla ${t.ventanilla || ""}.`.replace(" .", ".")
    : terminado ? "Tu turno ya terminó. Gracias por tu visita."
    : t.delante === 0 ? "Eres el siguiente. Mantente atento." : `Tienes ${t.delante} ${t.delante === 1 ? "persona" : "personas"} delante.`;
  $("#ticket-llamando").textContent = !llamado && !terminado && t.llamandoAhora ? `Ahora atienden el ${t.llamandoAhora.numero}${t.llamandoAhora.ventanilla ? " en la ventanilla " + t.llamandoAhora.ventanilla : ""}.` : "";
  $("#ticket-nuevo").hidden = !terminado;
  document.title = llamado ? `¡Te toca! ${t.numero} | Notaría 41` : `${t.numero} | Notaría 41`;
  if (llamado && !avisado) { avisado = true; try { navigator.vibrate?.([300, 150, 300]); } catch (e) {} }
  if (terminado) { clearInterval(temporizador); olvidar(); codigo = null; }
}

async function consultar() {
  try {
    const r = await fetch(`/api/turnos?accion=estado&codigo=${codigo}`);
    const d = await r.json().catch(() => ({}));
    if (r.status === 503) return apagado(d.error);
    if (r.status === 404) { olvidar(); clearInterval(temporizador); codigo = null; return mostrar("#tomar"); }
    if (r.ok) pintar(d);
  } catch (e) { /* sin conexión: se reintenta en el siguiente ciclo */ }
}
function seguir(c) {
  codigo = c; avisado = false;
  clearInterval(temporizador);
  temporizador = setInterval(() => { if (!document.hidden) consultar(); }, 10000);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.hidden = true;
  const datos = Object.fromEntries(new FormData(form));
  if (datos.nombre.trim().length < 2) { error.textContent = "Escribe tu nombre."; error.hidden = false; return form.elements.nombre.focus(); }
  if (!aceptacion.puedeEnviar()) return;
  const boton = $("#turno-enviar");
  boton.disabled = true; boton.textContent = "Tomando tu turno…";
  try {
    const r = await fetch("/api/turnos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "tomar", ...datos, ...banderasAceptacion() }) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 503) return apagado(d.error);
    if (!r.ok) { if (d.aceptacion) aceptacion.pedirOtraVez(); error.textContent = d.error || "No pudimos darte un turno. Acércate a recepción."; error.hidden = false; return; }
    guardar(d.codigo); seguir(d.codigo); pintar(d);
  } catch (err) {
    error.textContent = "Sin conexión. Revisa tu internet o acércate a recepción."; error.hidden = false;
  } finally { boton.disabled = false; boton.textContent = "Tomar mi turno"; }
});
$("#ticket-nuevo").addEventListener("click", () => { form.reset(); mostrar("#tomar"); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && codigo) consultar(); });

const guardado = leer();
if (guardado) { seguir(guardado); consultar(); } else mostrar("#tomar");
