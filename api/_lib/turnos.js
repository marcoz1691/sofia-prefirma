// Turnero de la notaría: el cliente toma un número con el QR de la entrada, ve cuántas personas tiene delante y recibe
// el aviso cuando lo llaman (en su pantalla y, si dejó su celular, por WhatsApp). El personal llama desde el panel.
import { randomBytes } from "node:crypto";
import { leerAjustes, errorWeb } from "./funciones.js";
import { huellaIp } from "./huella.js";
import { registrarConsentimiento } from "./consentimiento.js";
import { registrar } from "./metricas.js";
import { celular as normalizarCelular } from "./citas.js";
import { Aviso } from "./errores.js";

const HORA = 3600 * 1000, DIA = 24 * HORA;
// Lo que el personal puede hacer con un turno: atender o marcar ausente al llamado, devolver a la fila al ausente.
const TRANSICIONES = { llamado: ["atendido", "ausente"], ausente: ["esperando"], esperando: ["cancelado"] };
const TEXTO_CONSENTIMIENTO = "Turnero de la notaría: acepto los términos y condiciones; autorizo el tratamiento de mis datos según el aviso de privacidad";
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const limpio = (v, n) => String(v ?? "").replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n);

export const fechaQuito = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
export const etiqueta = (numero) => "T-" + String(numero).padStart(3, "0");

// Lo que ve el cliente: su número, su estado, cuántos tiene delante y a qué número se está llamando.
export function vistaCliente(turno, delDia) {
  const delante = delDia.filter((t) => t.estado === "esperando" && t.numero < turno.numero).length;
  const llamando = delDia.filter((t) => t.estado === "llamado").sort((a, b) => String(b.llamadoEn).localeCompare(String(a.llamadoEn)))[0];
  return { numero: etiqueta(turno.numero), estado: turno.estado, delante, ventanilla: turno.ventanilla || "",
    llamandoAhora: llamando ? { numero: etiqueta(llamando.numero), ventanilla: llamando.ventanilla } : null };
}

export function crearManejadorTurnos({ almacen, ahora = () => Date.now() }) {
  async function tomar(b, request) {
    const nombre = limpio(b.nombre, 60), motivo = limpio(b.motivo, 80);
    const cel = String(b.celular || "").trim() ? normalizarCelular(b.celular) : null;
    if (nombre.length < 2) return json({ error: "Escribe tu nombre.", campo: "nombre" }, 400);
    if (String(b.celular || "").trim() && !cel) return json({ error: "Revisa tu celular (ejemplo: 099 123 4567) o déjalo en blanco.", campo: "celular" }, 400);
    if (b.aceptaTerminos !== true || b.aceptaDatos !== true) return json({ error: "Marca las dos casillas para tomar tu turno.", aceptacion: true }, 400);
    const t = ahora(), huella = huellaIp(request);
    const [nIp, nDia] = await Promise.all([almacen.contarUso("turnos:ip:" + huella, HORA, t), almacen.contarUso("turnos:dia", DIA, t)]);
    if (nIp > 6 || nDia > 600) return json({ error: "Se tomaron muchos turnos desde este equipo. Acércate a recepción." }, 429);
    const codigo = randomBytes(12).toString("hex");
    const turno = await almacen.crearTurno({ fecha: fechaQuito(t), nombre, celular: cel, motivo, canal: "web", codigo });
    await registrarConsentimiento(almacen, { canal: "turnero", titular: "turno:" + codigo, texto: TEXTO_CONSENTIMIENTO, t: new Date(t) });
    await registrar(almacen, "turno.tomado", 1, t);
    return json({ codigo, ...vistaCliente(turno, await almacen.turnosDelDia(turno.fecha)) });
  }

  async function estado(q) {
    const codigo = q.get("codigo") || "";
    if (!/^[0-9a-f]{24}$/.test(codigo)) return json({ error: "No encontramos tu turno." }, 404);
    const turno = await almacen.turnoPorCodigo(codigo);
    if (!turno) return json({ error: "No encontramos tu turno." }, 404);
    return json(vistaCliente(turno, await almacen.turnosDelDia(turno.fecha)));
  }

  // Pantalla de la sala: solo números y ventanillas, nunca nombres.
  async function sala() {
    const hoy = await almacen.turnosDelDia(fechaQuito(ahora()));
    const llamados = hoy.filter((t) => ["llamado", "atendido"].includes(t.estado) && t.llamadoEn)
      .sort((a, b) => String(b.llamadoEn).localeCompare(String(a.llamadoEn))).slice(0, 6)
      .map((t) => ({ numero: etiqueta(t.numero), ventanilla: t.ventanilla, actual: t.estado === "llamado" }));
    return json({ llamados, esperando: hoy.filter((t) => t.estado === "esperando").length });
  }

  return {
    async GET(request) {
      const apagado = errorWeb(await leerAjustes(almacen), "turnero");
      if (apagado) return json(apagado, 503);
      const q = new URL(request.url).searchParams;
      if (q.get("accion") === "estado") return estado(q);
      if (q.get("accion") === "sala") return sala();
      return json({ error: "Acción desconocida" }, 400);
    },
    async POST(request) {
      const apagado = errorWeb(await leerAjustes(almacen), "turnero");
      if (apagado) return json(apagado, 503);
      let b;
      try { b = await request.json(); } catch { return json({ error: "Solicitud inválida" }, 400); }
      if (b?.accion === "tomar") return tomar(b, request);
      return json({ error: "Acción desconocida" }, 400);
    }
  };
}

// Panel: la fila del día y las acciones del personal.
export async function filaDelDia(almacen, ahora = Date.now()) {
  const fecha = fechaQuito(ahora), turnos = await almacen.turnosDelDia(fecha);
  return { fecha, turnos: turnos.map((t) => ({ id: t.id, numero: etiqueta(t.numero), nombre: t.nombre, motivo: t.motivo, celular: !!t.celular,
    estado: t.estado, ventanilla: t.ventanilla, creado: t.creado, llamadoEn: t.llamadoEn })) };
}

export async function llamarSiguiente(almacen, { ventanilla, whatsapp, plantilla = "turno_llamado", ahora = Date.now() }) {
  const v = limpio(ventanilla, 12) || "1";
  for (let intento = 0; intento < 3; intento++) {
    const siguiente = (await almacen.turnosDelDia(fechaQuito(ahora))).find((t) => t.estado === "esperando");
    if (!siguiente) return { llamado: null, ...(await filaDelDia(almacen, ahora)) };
    // La actualización condicionada evita que dos ventanillas llamen al mismo número.
    if (await almacen.actualizarTurno(siguiente.id, { estado: "llamado", ventanilla: v, llamadoEn: new Date(ahora).toISOString() }, { siEstado: "esperando" })) {
      await registrar(almacen, "turno.llamado", 1, ahora);
      if (siguiente.celular && whatsapp?.enviarPlantilla) {
        try { await whatsapp.enviarPlantilla(siguiente.celular, plantilla, [etiqueta(siguiente.numero), v]); }
        catch (e) { console.error("Turnero: no se pudo avisar por WhatsApp:", e.message); }
      }
      return { llamado: { numero: etiqueta(siguiente.numero), nombre: siguiente.nombre, ventanilla: v }, ...(await filaDelDia(almacen, ahora)) };
    }
  }
  throw new Aviso("Otra ventanilla llamó al mismo tiempo. Vuelve a tocar «Llamar siguiente».");
}

export async function marcarTurno(almacen, { id, estado }, ahora = Date.now()) {
  const t = typeof id === "string" && /^[0-9a-f-]{36}$/.test(id) ? await almacen.turnoPorId(id) : null;
  if (!t || t.fecha !== fechaQuito(ahora)) throw new Aviso("Ese turno no es de hoy. Recarga la fila.");
  if (!(TRANSICIONES[t.estado] || []).includes(estado)) throw new Aviso("Ese turno ya cambió de estado. Recarga la fila.");
  // Condicionada al estado leído: si otra persona lo cambió en el medio, no se pisa.
  const ok = await almacen.actualizarTurno(id, { estado, ...(estado === "atendido" ? { atendidoEn: new Date(ahora).toISOString() } : {}) }, { siEstado: t.estado });
  if (!ok) throw new Aviso("Ese turno ya cambió de estado. Recarga la fila.");
  return filaDelDia(almacen, ahora);
}
