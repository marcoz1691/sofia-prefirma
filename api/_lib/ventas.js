// Agente de ventas y atención de SOFIA PreFirma (chat de la página comercial). Reutiliza el almacén del asistente
// de la notaría (sesiones, historial, métricas) en su propio espacio, el tenant «sofia-ventas».
import { registrar } from "./metricas.js";
import { sistemaVentas } from "./catalogo-ventas.js";
import { elegirModelo, textosDeCliente, registrarUso, COMPLEJO_VENTAS } from "./modelos.js";

const ESFUERZO = process.env.VENTAS_EFFORT || "low";
const RESPALDO = "server-side-fallback-2026-07-01";
const INACTIVIDAD_MS = 24 * 60 * 60 * 1000;
const MAX_VUELTAS = 4;
const MAX_PROSPECTOS = 3;           // registros por conversación: evita que un chat llene la lista
const DISCULPA = "Disculpa, tuve un problema para responderte. Inténtalo de nuevo en unos minutos.";
const SIN_TEXTO = "Disculpa, no pude completar tu consulta. ¿Quieres que un asesor te contacte?";
const ERROR_DE_HISTORIAL = /thinking|tool_use|tool_result|messages\.\d|prefix|role/i;
const MOTIVOS = ["demostracion", "cotizacion", "contratar", "asesor", "soporte"];
const corto = (v, n) => String(v ?? "").replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n);
const CORREO = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

const HERRAMIENTAS = [{
  name: "registrar_interes",
  description: "Registra a una persona interesada en SOFIA PreFirma (o a un cliente actual con un problema) para que un asesor la contacte. Úsala solo cuando la persona te haya dado su nombre y al menos un teléfono o un correo, y quiera una demostración, una cotización, contratar, hablar con un asesor o reportar un problema.",
  input_schema: {
    type: "object",
    properties: {
      nombre: { type: "string", description: "nombre de la persona" },
      notaria: { type: "string", description: "nombre o número de la notaría" },
      ciudad: { type: "string" },
      cargo: { type: "string", description: "notario, personal administrativo, otro" },
      telefono: { type: "string", description: "celular o teléfono de contacto" },
      correo: { type: "string", description: "correo de contacto" },
      plan: { type: "string", description: "plan que le interesa, si lo dijo" },
      motivo: { type: "string", enum: MOTIVOS },
      detalle: { type: "string", description: "resumen breve de lo que necesita" }
    },
    required: ["nombre", "motivo"]
  }
}];

export function crearAgenteVentas({ claude, almacen, avisar = async () => {}, whatsapp = "", ahora = () => new Date() }) {
  const sistema = sistemaVentas({ whatsapp });

  async function registrarInteres(entrada, conv, t) {
    const p = {
      nombre: corto(entrada.nombre, 80), notaria: corto(entrada.notaria, 120), ciudad: corto(entrada.ciudad, 60),
      cargo: corto(entrada.cargo, 60), telefono: corto(entrada.telefono, 30).replace(/[^\d+ ()-]/g, ""),
      correo: corto(entrada.correo, 200).toLowerCase(), plan: corto(entrada.plan, 40),
      motivo: MOTIVOS.includes(entrada.motivo) ? entrada.motivo : "asesor", detalle: corto(entrada.detalle, 500)
    };
    if (p.nombre.length < 2) return { error: "Falta el nombre de la persona." };
    const telefonoOk = p.telefono.replace(/\D/g, "").length >= 7;
    if (p.correo && !CORREO.test(p.correo)) p.correo = "";
    if (!telefonoOk && !p.correo) return { error: "Falta un teléfono o un correo válido para que un asesor pueda contactar a la persona." };
    if (!telefonoOk) p.telefono = "";
    if (await almacen.contarUso("ventas:prospecto:" + conv.id, INACTIVIDAD_MS, t.getTime()) > MAX_PROSPECTOS)
      return { error: "Ya se registró el contacto de esta conversación. Confirma a la persona que un asesor la contactará." };
    await almacen.guardarProspecto({ conversacionId: conv.id, ...p });
    await registrar(almacen, "ventas.prospecto", 1, t);
    await avisar(`Nuevo interesado en SOFIA PreFirma (${p.motivo}): ${p.nombre}` + (p.cargo ? `, ${p.cargo}` : "") +
      (p.notaria ? ` · ${p.notaria}` : "") + (p.ciudad ? `, ${p.ciudad}` : "") + (p.plan ? ` · plan ${p.plan}` : "") +
      ` · ${[p.telefono, p.correo].filter(Boolean).join(" · ")}` + (p.detalle ? ` · ${p.detalle}` : ""));
    return { ok: true, mensaje: "Registrado. Un asesor de SOFIA PreFirma contactará a la persona por el medio que dio, en horario laboral." };
  }

  async function ejecutar(b, ctx) {
    const resultado = (contenido, esError = false) => ({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(contenido), ...(esError ? { is_error: true } : {}) });
    if (b.name !== "registrar_interes") return resultado({ error: `Herramienta desconocida: ${b.name}` }, true);
    try {
      const r = await registrarInteres(b.input || {}, ctx.conv, ctx.t);
      return resultado(r, !!r.error);
    } catch (e) {
      console.error("No se pudo registrar el interés:", e?.message || e);
      return resultado({ error: "No se pudo registrar ahora. Ofrece a la persona escribir de nuevo en unos minutos." }, true);
    }
  }

  // Un turno del chat: el mensaje de la persona, las respuestas de Claude y las herramientas que pida.
  async function atender({ sesion, texto }) {
    const t = ahora();
    const titular = "web:" + sesion;
    const conv = await almacen.conversacion(titular, "");
    await registrar(almacen, "msg.cliente.web", 1, t);
    await almacen.marcarClienteEscribio(conv.id, t.getTime());
    let s = await almacen.sesionActiva(conv.id, { ahora: t.getTime(), sistema, inactividadMs: INACTIVIDAD_MS });
    const usuario = { role: "user", content: texto };
    const eleccion = elegirModelo({ textos: [...textosDeCliente(s.mensajes), texto], patron: COMPLEJO_VENTAS });
    const historial = [usuario];
    let porGuardar = [usuario];
    const respuestas = [];
    const guardar = async () => { if (porGuardar.length) { await almacen.agregarMensajes(s.id, porGuardar, ahora().getTime()); porGuardar = []; } };
    const llamar = () => claude.beta.messages.create({
      model: eleccion.modelo,
      max_tokens: 4000,
      betas: [RESPALDO],
      fallbacks: "default",
      output_config: { effort: ESFUERZO },
      cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: s.sistema, cache_control: { type: "ephemeral" } }],
      tools: HERRAMIENTAS,
      messages: [...s.mensajes, ...historial]
    });

    try {
      for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
        let r;
        try {
          r = await llamar();
        } catch (e) {
          if (e?.status === 400 && vuelta === 0 && s.mensajes.length && ERROR_DE_HISTORIAL.test(e.message)) {
            console.warn("Historial de ventas rechazado por la API; se abre una sesión nueva:", e.message);
            s = await almacen.sesionActiva(conv.id, { ahora: t.getTime(), sistema, inactividadMs: INACTIVIDAD_MS, nueva: true });
            r = await llamar();
          } else throw e;
        }
        await registrarUso(almacen, r.usage, eleccion.avanzado, t);
        const asistente = { role: "assistant", content: r.content };
        historial.push(asistente); porGuardar.push(asistente);
        for (const b of r.content) if (b.type === "text" && b.text.trim()) respuestas.push(b.text.trim());
        if (r.stop_reason === "refusal" && !respuestas.length) respuestas.push("Disculpa, no puedo ayudarte con eso por aquí. Puedo contarte sobre SOFIA PreFirma o pedir que un asesor te contacte.");
        if (r.stop_reason !== "tool_use") break;
        const resultados = [];
        for (const b of r.content.filter((x) => x.type === "tool_use")) resultados.push(await ejecutar(b, { conv, t }));
        const res = { role: "user", content: resultados };
        historial.push(res); porGuardar.push(res);
        await guardar();
      }
      await guardar();
    } catch (e) {
      console.error(`Error en el chat de ventas ${conv.id}: ${e?.status || ""} ${e?.message || e}`);
      porGuardar.push({ role: "assistant", content: [{ type: "text", text: DISCULPA }] });
      await guardar();
      return [...respuestas, DISCULPA];
    }
    return respuestas.length ? respuestas : [SIN_TEXTO];
  }

  return { atender };
}
