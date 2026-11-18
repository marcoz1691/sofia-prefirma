// Página correo-notarial.html: arma el dominio notaria(número)(cantón).com mientras se escribe, pregunta si está libre
// (/api/ventas, accion «dominio») y envía el pedido con el mismo formulario de ventas (accion «solicitar»).
import { armarDominio } from "./dominio-notarial.js";

const $ = (id) => document.getElementById(id);
const buscador = $("buscador"), numero = $("b-numero"), canton = $("b-canton");
const vista = $("b-correo"), resultado = $("b-resultado"), revisar = $("b-revisar");
const pedido = $("pedido"), error = $("p-error"), enviar = $("p-enviar");
let dominioElegido = "";

const MENSAJES = {
  libre: (d) => `<i class="ph ph-check" aria-hidden="true"></i><div><b>${d} está libre.</b> Pídalo antes de que alguien más lo registre. <a href="#pedir">Pedir mi correo</a></div>`,
  ocupado: (d) => `<i class="ph ph-info" aria-hidden="true"></i><div><b>${d} ya está registrado.</b> Si es de su notaría, configuramos sus correos con él. Si no, buscamos con usted una alternativa.</div>`,
  desconocido: (d) => `<i class="ph ph-info" aria-hidden="true"></i><div><b>No pudimos revisar ${d} ahora.</b> Déjenos sus datos y lo revisamos por usted.</div>`,
};

function actualizarVista() {
  const d = armarDominio(numero.value, canton.value);
  vista.textContent = "nombre.apellido@" + (d || "notaria(número)(cantón).com");
  if (d !== dominioElegido) resultado.hidden = true;
  return d;
}

function mostrarDominio(d) {
  dominioElegido = d;
  const linea = $("p-dominio");
  linea.hidden = !d;
  linea.textContent = d ? `Dominio que pide: ${d}` : "";
  const notaria = $("p-notaria");
  if (!notaria.value && numero.value && canton.value) notaria.value = `Notaría ${numero.value.replace(/\D/g, "")} de ${canton.value.trim()}`;
}

numero.addEventListener("input", actualizarVista);
canton.addEventListener("input", actualizarVista);

buscador.addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = actualizarVista();
  if (!d) {
    resultado.hidden = false;
    resultado.className = "buscador__resultado es-aviso";
    resultado.textContent = "Escriba el número de su notaría y su cantón.";
    return;
  }
  revisar.disabled = true;
  revisar.textContent = "Revisando…";
  let estado = "desconocido";
  try {
    const r = await fetch("/api/ventas", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "dominio", numero: numero.value, canton: canton.value }) });
    const datos = await r.json();
    if (r.ok && MENSAJES[datos.estado]) estado = datos.estado;
  } catch { /* se informa como «desconocido» */ }
  resultado.className = "buscador__resultado es-" + estado;
  resultado.innerHTML = MENSAJES[estado](d);
  resultado.hidden = false;
  mostrarDominio(d);
  revisar.disabled = false;
  revisar.textContent = "Revisar";
});

document.querySelectorAll("[data-elegir]").forEach((a) => a.addEventListener("click", () => { $("p-plan").value = a.dataset.elegir; }));

pedido.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.hidden = true;
  const f = new FormData(pedido);
  const cuerpo = { accion: "solicitar", plan: f.get("plan"), periodo: f.get("periodo"), nombre: f.get("nombre"), notaria: f.get("notaria"),
    ciudad: canton.value.trim(), cargo: f.get("cargo"), telefono: f.get("telefono"), correo: f.get("correo"),
    dominio: dominioElegido || armarDominio(numero.value, canton.value) || "",
    aceptaTerminos: f.get("aceptaTerminos") === "on", aceptaDatos: f.get("aceptaDatos") === "on" };
  const falta = String(cuerpo.nombre).trim().length < 2 ? "Escriba su nombre."
    : String(cuerpo.notaria).trim().length < 2 ? "Escriba el nombre o número de su notaría."
    : String(cuerpo.telefono).replace(/\D/g, "").length < 7 ? "Escriba un celular válido para contactarle."
    : !cuerpo.aceptaTerminos || !cuerpo.aceptaDatos ? "Marque las dos casillas para enviar su pedido." : "";
  if (falta) { error.textContent = falta; error.hidden = false; return; }
  enviar.disabled = true;
  try {
    const r = await fetch("/api/ventas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(datos.error || "No pudimos enviar su pedido. Inténtelo de nuevo.");
    pedido.hidden = true;
    const listo = $("p-listo");
    if (cuerpo.dominio) $("p-listo-texto").textContent = `En un día hábil le escribimos por WhatsApp para confirmar ${cuerpo.dominio} y empezar.`;
    listo.hidden = false;
    listo.focus();
  } catch (err) {
    error.textContent = err.message === "Failed to fetch" ? "No hay conexión. Inténtelo de nuevo." : err.message;
    error.hidden = false;
  } finally {
    enviar.disabled = false;
  }
});

actualizarVista();
