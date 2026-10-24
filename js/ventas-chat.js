// Chat de ventas y atención de SOFIA PreFirma en la página comercial. Reutiliza el formato y las sesiones del chat de la
// notaría (chat-nucleo.js) y las casillas de consentimiento (aceptacion.js) con los textos legales de SOFIA PreFirma.
import { esc, formato, nuevaSesion } from "./chat-nucleo.js";
import { crearAceptacion } from "./aceptacion.js";
import { AVISO_PRIVACIDAD_PREFIRMA, TERMINOS_PREFIRMA } from "./legal.js";

const CLAVE = "sp-ventas-chat";
const AVATAR = '<span class="vchat__avatar"><img src="assets/logo/sofia-prefirma-oficial-simbolo.svg" alt=""></span>';
const $ = (s) => document.querySelector(s);
const abrirBoton = $("#vchat-abrir"), panel = $("#vchat"), hilo = $("#vchat-hilo"), lista = $("#vchat-mensajes");
const form = $("#vchat-form"), campo = $("#vchat-texto"), enviarBoton = $("#vchat-enviar"), inicio = $("#vchat-inicio");
const aceptacion = crearAceptacion({ clave: "sp-ventas-acepta", aviso: AVISO_PRIVACIDAD_PREFIRMA, terminos: TERMINOS_PREFIRMA,
  enlaceTerminos: "prefirma-terminos.html", enlacePrivacidad: "prefirma-privacidad.html" });

function leer() {
  try { const c = JSON.parse(localStorage.getItem(CLAVE)); if (c && /^s_[0-9a-f]{24}$/.test(c.sesion) && Array.isArray(c.mensajes)) return c; } catch (e) {}
  return { sesion: nuevaSesion(), mensajes: [] };
}
let chat = leer(), control = null, enviando = false;
function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify({ sesion: chat.sesion, mensajes: chat.mensajes.slice(-40) })); } catch (e) {} }

function nodo(m) {
  const art = document.createElement("article");
  art.className = "vchat__msg vchat__msg--" + m.autor;
  if (m.autor === "cliente") art.innerHTML = '<div class="vchat__burbuja">' + esc(m.texto).replace(/\n/g, "<br>") + "</div>";
  else if (m.autor === "aviso") art.innerHTML = '<p class="vchat__aviso" role="alert">' + esc(m.texto) + "</p>";
  else art.innerHTML = AVATAR + '<div class="vchat__texto">' + formato(m.texto) + "</div>";
  return art;
}
function abajo() { hilo.scrollTop = hilo.scrollHeight; }
function agregar(m) {
  chat.mensajes.push(m); guardar();
  inicio.hidden = true;
  lista.appendChild(nodo(m)); abajo();
}
function pintar() {
  lista.innerHTML = "";
  chat.mensajes.forEach((m) => lista.appendChild(nodo(m)));
  inicio.hidden = chat.mensajes.length > 0;
}

function abrir() {
  panel.hidden = false;
  abrirBoton.setAttribute("aria-expanded", "true");
  document.body.classList.add("vchat-abierto");
  control ||= aceptacion.montar(form, "vchat__aceptacion");
  abajo();
  campo.focus();
}
function cerrar() {
  panel.hidden = true;
  abrirBoton.setAttribute("aria-expanded", "false");
  document.body.classList.remove("vchat-abierto");
  abrirBoton.focus();
}

async function pedir(texto) {
  try {
    const r = await fetch("/api/ventas", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sesion: chat.sesion, texto, ...aceptacion.banderas() }) });
    const data = await r.json().catch(() => ({}));
    return r.ok ? { respuestas: data.respuestas || [] } : { error: data.error || "No pude responder ahora. Inténtalo de nuevo en unos minutos.", aceptacion: data.aceptacion === true };
  } catch (e) { return { error: "Sin conexión. Revisa tu internet e inténtalo de nuevo." }; }
}

async function enviar(texto) {
  texto = texto.trim();
  if (!texto || enviando) return;
  if (!control.puedeEnviar()) { campo.value = texto; campo.dispatchEvent(new Event("input")); return; }
  enviando = true; enviarBoton.disabled = true;
  agregar({ autor: "cliente", texto });
  const pensando = document.createElement("article");
  pensando.className = "vchat__msg vchat__msg--asistente";
  pensando.innerHTML = AVATAR + '<div class="vchat__pensando" aria-label="Sofía está escribiendo"><span></span><span></span><span></span></div>';
  lista.appendChild(pensando); abajo();
  const r = await pedir(texto);
  pensando.remove();
  if (r.aceptacion) control.pedirOtraVez();
  if (r.error) agregar({ autor: "aviso", texto: r.error });
  else r.respuestas.forEach((t) => agregar({ autor: "asistente", texto: t }));
  enviando = false; enviarBoton.disabled = !campo.value.trim(); campo.focus();
}

abrirBoton.addEventListener("click", () => (panel.hidden ? abrir() : cerrar()));
$("#vchat-cerrar").addEventListener("click", cerrar);
document.querySelectorAll("[data-abrir-chat]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); abrir(); }));
panel.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrar(); });
form.addEventListener("submit", (e) => { e.preventDefault(); const t = campo.value; campo.value = ""; campo.style.height = ""; enviarBoton.disabled = true; enviar(t); });
campo.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
campo.addEventListener("input", () => { campo.style.height = "auto"; campo.style.height = Math.min(campo.scrollHeight, 140) + "px"; enviarBoton.disabled = enviando || !campo.value.trim(); });
$("#vchat-sugerencias").addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b) enviar(b.dataset.p); });

pintar();
