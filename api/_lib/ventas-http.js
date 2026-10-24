// API del chat de ventas de SOFIA PreFirma: mismas reglas que el chat de la notaría (sesión, límites, huella de IP y
// dos casillas antes del primer mensaje), con los textos legales de SOFIA PreFirma.
import { leerAjustes, leerFunciones } from "./funciones.js";
import { huellaIp } from "./huella.js";
import { registrarConsentimiento } from "./consentimiento.js";
import { AVISO_PRIVACIDAD_PREFIRMA, TERMINOS_PREFIRMA } from "../../js/legal.js";
import { PLANES } from "./catalogo-ventas.js";
import { registrar } from "./metricas.js";

const HORA = 3600 * 1000, DIA = 24 * HORA;
const LIMITES = { porSesion: 25, porIp: 60, porDia: 600 };
const SATURADO = "Por ahora el chat recibió muchos mensajes. Inténtalo más tarde o déjanos tu contacto en otro momento.";
const APAGADO = "El chat de SOFIA PreFirma no está disponible por ahora. Inténtalo más tarde.";
const TEXTO_CHAT = "Casillas del chat de SOFIA PreFirma: acepto los términos y condiciones; autorizo el tratamiento de mis datos según el aviso de privacidad";
const TEXTO_FORMULARIO = "Formulario «Elegir plan» de SOFIA PreFirma: acepto los términos y condiciones; autorizo el tratamiento de mis datos según el aviso de privacidad";
const CARGOS = ["Notario o notaria", "Personal de la notaría", "Otro"];
const CORREO = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const limpio = (v, n) => String(v ?? "").replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const IVA = 0.15;
const SIN_PAGO = "El pago en línea todavía no está disponible. Un asesor te enviará el enlace de pago.";

export function crearManejadorVentas({ agente, almacen, avisar = async () => {}, proveedor = null, ahora = () => Date.now(), limites = LIMITES }) {
  // Pago en línea del plan: el servidor fija el monto (plan + período + IVA) y PagoMedios aloja la página de pago.
  async function pagar(b, request) {
    if (!proveedor) return json({ error: SIN_PAGO }, 404);
    const plan = PLANES.find((x) => x.nombre === b.plan && x.mensual > 0), periodo = b.periodo === "anual" ? "anual" : "mensual";
    const p = { nombre: limpio(b.nombre, 80), notaria: limpio(b.notaria, 120), telefono: limpio(b.telefono, 30).replace(/[^\d+ ()-]/g, ""),
      correo: limpio(b.correo, 200).toLowerCase(), documento: String(b.documento || "").replace(/\D/g, "") };
    if (!plan) return json({ error: "Elige un plan de pago." }, 400);
    if (p.nombre.length < 2 || p.telefono.replace(/\D/g, "").length < 7) return json({ error: "Faltan tus datos de contacto." }, 400);
    if (!/^\d{10}(\d{3})?$/.test(p.documento)) return json({ error: "Escribe tu cédula (10 dígitos) o RUC (13 dígitos) para la factura.", campo: "documento" }, 400);
    if (p.correo && !CORREO.test(p.correo)) p.correo = "";
    if (b.aceptaTerminos !== true || b.aceptaDatos !== true) return json({ error: "Marca las dos casillas para continuar." }, 400);
    const t = ahora();
    if (await almacen.contarUso("ventas:pago:ip:" + huellaIp(request), HORA, t) > 5) return json({ error: "Demasiados intentos desde esta conexión. Inténtalo más tarde." }, 429);
    const baseCentavos = plan.mensual * (periodo === "anual" ? 10 : 1) * 100, ivaCentavos = Math.round(baseCentavos * IVA);
    const fila = await almacen.crearPagoPlan({ plan: plan.nombre, periodo, baseCentavos, ivaCentavos, totalCentavos: baseCentavos + ivaCentavos, proveedor: proveedor.nombre, ...p });
    await registrarConsentimiento(almacen, { canal: "pago-plan", titular: "pago:" + fila.id, texto: TEXTO_FORMULARIO, t: new Date(t),
      versiones: { aviso: AVISO_PRIVACIDAD_PREFIRMA, terminos: TERMINOS_PREFIRMA } });
    try {
      const urlAviso = proveedor.enlaceAviso(new URL("/api/ventas?aviso=plan", request.url).href, fila.id);
      const { orden, urlCheckout } = await proveedor.crearOrden({ pago: { id: fila.id, montoCentavos: fila.totalCentavos, concepto: `SOFIA PreFirma, plan ${plan.nombre} (pago ${periodo})` },
        pagador: { documento: p.documento, nombre: p.notaria ? `${p.nombre} · ${p.notaria}` : p.nombre, correo: p.correo, celular: p.telefono }, urlAviso });
      await almacen.actualizarPagoPlan(fila.id, { ordenProveedor: orden, estado: "pendiente" }, { siEstado: "creado" });
      await registrar(almacen, "ventas.pago_iniciado", 1, t);
      return json({ id: fila.id, urlCheckout, totalCentavos: fila.totalCentavos });
    } catch (e) {
      console.error("Ventas: no se pudo crear el pago en PagoMedios:", e.message);
      await almacen.actualizarPagoPlan(fila.id, { estado: "fallido" }, { siEstado: "creado" });
      return json({ error: "No pudimos abrir el pago en línea. Inténtalo más tarde o espera el enlace del asesor." }, 502);
    }
  }

  // Confirma el estado preguntando a PagoMedios (nunca al navegador) y avisa una sola vez cuando queda pagado.
  async function conciliar(id) {
    const fila = await almacen.pagoPlan(id);
    if (!fila || !fila.ordenProveedor || fila.estado !== "pendiente") return fila;
    const c = await proveedor.consultarPago({ orden: fila.ordenProveedor });
    const pagadoBien = c.estado === "pagado" && c.monto === fila.totalCentavos;
    const nuevo = pagadoBien ? "pagado" : ["fallido", "reembolsado"].includes(c.estado) ? c.estado : null;
    if (nuevo && await almacen.actualizarPagoPlan(id, { estado: nuevo, ...(nuevo === "pagado" ? { pagadoEn: new Date(ahora()).toISOString() } : {}) }, { siEstado: "pendiente" })) {
      if (nuevo === "pagado") {
        await registrar(almacen, "ventas.pago_aprobado", 1, ahora());
        await avisar(`Pago recibido en SOFIA PreFirma: plan ${fila.plan} (${fila.periodo}), USD ${(fila.totalCentavos / 100).toFixed(2)} · ${fila.nombre}` + (fila.notaria ? ` · ${fila.notaria}` : "") + ` · ${fila.telefono}`);
      }
      return { ...fila, estado: nuevo };
    }
    if (c.estado === "pagado" && !pagadoBien) console.warn("Ventas: PagoMedios reporta un monto distinto en", id);
    return fila;
  }

  async function estadoPago(b) {
    if (!proveedor) return json({ error: SIN_PAGO }, 404);
    const id = String(b.id || "");
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "No encontramos ese pago." }, 404);
    try {
      const fila = await conciliar(id);
      return fila ? json({ estado: fila.estado, plan: fila.plan, totalCentavos: fila.totalCentavos }) : json({ error: "No encontramos ese pago." }, 404);
    } catch (e) {
      console.error("Ventas: no se pudo consultar el pago:", e.message);
      return json({ error: "No pudimos revisar el pago ahora. Inténtalo en unos minutos." }, 502);
    }
  }

  async function aviso(request) {
    if (!proveedor) return json({ error: "No disponible" }, 404);
    const ev = await proveedor.procesarWebhook(request);
    if (!ev.valido) return json({ error: "Firma inválida" }, 401);
    try { await conciliar(ev.pagoId); } catch (e) { console.error("Ventas: aviso de PagoMedios sin conciliar:", e.message); return json({ error: "Reintenta" }, 502); }
    return json({ ok: true });
  }

  // «Elegir plan»: la notaría pide su mes de prueba gratis. No pasa por Claude: se valida, se guarda y se avisa al asesor.
  async function solicitar(b, request) {
    const p = { nombre: limpio(b.nombre, 80), notaria: limpio(b.notaria, 120), ciudad: limpio(b.ciudad, 60),
      cargo: CARGOS.includes(b.cargo) ? b.cargo : "", telefono: limpio(b.telefono, 30).replace(/[^\d+ ()-]/g, ""),
      correo: limpio(b.correo, 200).toLowerCase() };
    const plan = PLANES.find((x) => x.nombre === b.plan), periodo = b.periodo === "anual" ? "anual" : "mensual";
    if (p.nombre.length < 2) return json({ error: "Escribe tu nombre.", campo: "nombre" }, 400);
    if (p.notaria.length < 2) return json({ error: "Escribe el nombre o número de tu notaría.", campo: "notaria" }, 400);
    if (p.telefono.replace(/\D/g, "").length < 7) return json({ error: "Escribe un celular válido para contactarte.", campo: "telefono" }, 400);
    if (p.correo && !CORREO.test(p.correo)) return json({ error: "Revisa tu correo o déjalo en blanco.", campo: "correo" }, 400);
    if (!plan) return json({ error: "Elige un plan de la lista." }, 400);
    if (b.aceptaTerminos !== true || b.aceptaDatos !== true) return json({ error: "Marca las dos casillas para enviar tu solicitud.", campo: "acepta" }, 400);
    const t = ahora(), huella = huellaIp(request);
    const [nIp, nDia] = await Promise.all([almacen.contarUso("ventas:solicitud:ip:" + huella, HORA, t), almacen.contarUso("ventas:solicitud:dia", DIA, t)]);
    if (nIp > 5 || nDia > 200) return json({ error: "Recibimos muchas solicitudes desde esta conexión. Inténtalo más tarde o escríbele a Sofía." }, 429);
    const detalle = plan.mensual === 0 ? "Vitrina sin costo mensual" : `Mes de prueba gratis · pago ${periodo}`;
    await almacen.guardarProspecto({ conversacionId: null, ...p, plan: plan.nombre, motivo: "contratar", detalle });
    await registrarConsentimiento(almacen, { canal: "formulario-ventas", titular: "form:" + p.telefono.replace(/\D/g, ""), texto: TEXTO_FORMULARIO, t: new Date(t),
      versiones: { aviso: AVISO_PRIVACIDAD_PREFIRMA, terminos: TERMINOS_PREFIRMA } });
    await registrar(almacen, "ventas.solicitud", 1, t);
    await avisar(`Nueva solicitud de SOFIA PreFirma: plan ${plan.nombre} (${detalle}). ${p.nombre}` + (p.cargo ? `, ${p.cargo}` : "") +
      ` · ${p.notaria}` + (p.ciudad ? `, ${p.ciudad}` : "") + ` · ${[p.telefono, p.correo].filter(Boolean).join(" · ")}`);
    return json({ ok: true, plan: plan.nombre, periodo });
  }

  return {
    async POST(request) {
      if (new URL(request.url).searchParams.get("aviso") === "plan") return aviso(request);
      if (!leerFunciones(await leerAjustes(almacen)).chatWeb) return json({ error: APAGADO, apagada: true }, 503);
      let b;
      try { b = await request.json(); } catch { return json({ error: "Solicitud inválida" }, 400); }
      if (b?.accion === "solicitar") return solicitar(b, request);
      if (b?.accion === "pagar") return pagar(b, request);
      if (b?.accion === "estadoPago") return estadoPago(b);
      const sesion = String(b?.sesion || ""), texto = String(b?.texto || "").trim();
      if (!/^[A-Za-z0-9_-]{12,64}$/.test(sesion)) return json({ error: "Sesión inválida" }, 400);
      if (!texto) return json({ error: "Escribe un mensaje" }, 400);
      if (texto.length > 1000) return json({ error: "El mensaje es muy largo (máximo 1000 caracteres)" }, 400);
      if (b.aceptaTerminos !== true || b.aceptaDatos !== true)
        return json({ error: "Acepta los términos y autoriza el tratamiento de tus datos para chatear.", aceptacion: true }, 400);

      const huella = huellaIp(request);
      const t = ahora();
      const [nSesion, nIp, nDia] = await Promise.all([
        almacen.contarUso("ventas:sesion:" + sesion, HORA, t),
        almacen.contarUso("ventas:ip:" + huella, HORA, t),
        almacen.contarUso("ventas:dia", DIA, t)
      ]);
      if (nSesion > limites.porSesion || nIp > limites.porIp || nDia > limites.porDia) return json({ error: SATURADO }, 429);

      // La conversación nueva se cuenta aquí: después de esta línea ya existe y el agente no puede distinguirla.
      if (!await almacen.conversacionPorTelefono("web:" + sesion)) await registrar(almacen, "conv.nueva.web", 1, t);
      const conv = await almacen.conversacion("web:" + sesion, "");
      if (!conv.consentimiento) {
        await almacen.actualizarConversacion(conv.id, { consentimiento: true, consentimientoEn: new Date(t).toISOString(),
          consentimientoTexto: TEXTO_CHAT, consentimientoAviso: AVISO_PRIVACIDAD_PREFIRMA });
        await registrarConsentimiento(almacen, { canal: "chat-ventas", titular: "web:" + sesion, texto: TEXTO_CHAT, t: new Date(t),
          versiones: { aviso: AVISO_PRIVACIDAD_PREFIRMA, terminos: TERMINOS_PREFIRMA } });
      }
      const respuestas = await agente.atender({ sesion, texto });
      return json({ respuestas });
    }
  };
}
