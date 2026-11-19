// API del tablero de prospectos de SOFIA PreFirma (sofiaprefirma.com/ventas/). Es independiente del panel de una notaría:
// mismas reglas de acceso (token de Supabase, correo confirmado, verificación en dos pasos y persona registrada en
// «personal» del tenant de ventas), pero solo lee y edita la tabla «prospectos». Todo cambio queda en la auditoría.
import { PLANES, PLANES_CORREO } from "./catalogo-ventas.js";

export const ETAPAS = ["nuevo", "contactado", "demostracion", "propuesta", "ganado", "perdido"];
export const CONTRATOS = ["no_enviado", "enviado", "firmado"];
export const PAGOS = ["pendiente", "pagado"];
export const MOTIVOS = ["demostracion", "cotizacion", "contratar", "asesor", "soporte"];
const GENERICO = "No se pudo completar la acción. Intenta de nuevo en unos segundos.";
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const CORREO = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const limpio = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, "").trim().slice(0, n);
const enUnaLinea = (v, n) => String(v ?? "").replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n);

class Rechazo extends Error {}
const hoyEnQuito = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(new Date(ms));

export const PRECIOS_PLANES = [...PLANES, ...PLANES_CORREO].map((p) => ({ nombre: p.nombre, mensual: p.mensual }));

function fecha(v, campo) {
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !FECHA.test(v) || Number.isNaN(Date.parse(v + "T12:00:00Z"))) throw new Rechazo(`Revisa la fecha de ${campo}.`);
  return v;
}

// Solo pasan los campos conocidos y con valores válidos. Firmar el contrato marca la fecha y gana el prospecto.
export function validarCambios(b, actual, hoy) {
  const c = {};
  if ("etapa" in b) { if (!ETAPAS.includes(b.etapa)) throw new Rechazo("Etapa desconocida."); c.etapa = b.etapa; }
  if ("contrato" in b) { if (!CONTRATOS.includes(b.contrato)) throw new Rechazo("Estado de contrato desconocido."); c.contrato = b.contrato; }
  if ("pago" in b) { if (!PAGOS.includes(b.pago)) throw new Rechazo("Estado de pago desconocido."); c.pago = b.pago; }
  if ("firmadoEn" in b) c.firmadoEn = fecha(b.firmadoEn, "firma");
  if ("proximoEn" in b) c.proximoEn = fecha(b.proximoEn, "seguimiento");
  if ("valorMensual" in b) {
    const v = b.valorMensual === null || b.valorMensual === "" ? null : Number(b.valorMensual);
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100000)) throw new Rechazo("El valor mensual debe estar entre 0 y 100.000.");
    c.valorMensual = v === null ? null : Math.round(v * 100) / 100;
  }
  if ("proximoPaso" in b) c.proximoPaso = enUnaLinea(b.proximoPaso, 200);
  if ("notas" in b) c.notas = limpio(b.notas, 2000);
  if ("plan" in b) c.plan = enUnaLinea(b.plan, 40);
  if (!Object.keys(c).length) throw new Rechazo("No hay cambios para guardar.");
  if (c.contrato === "firmado" && actual.contrato !== "firmado") {
    if (!("firmadoEn" in c) && !actual.firmadoEn) c.firmadoEn = hoy;
    if (!("etapa" in c) && actual.etapa !== "ganado") c.etapa = "ganado";
  }
  if (c.contrato && c.contrato !== "firmado" && !("firmadoEn" in c)) c.firmadoEn = null;
  return c;
}

export function validarNuevo(b) {
  const p = { nombre: enUnaLinea(b.nombre, 80), notaria: enUnaLinea(b.notaria, 120), ciudad: enUnaLinea(b.ciudad, 60), cargo: enUnaLinea(b.cargo, 60),
    telefono: enUnaLinea(b.telefono, 30).replace(/[^\d+ ()-]/g, ""), correo: enUnaLinea(b.correo, 200).toLowerCase(), plan: enUnaLinea(b.plan, 40),
    motivo: MOTIVOS.includes(b.motivo) ? b.motivo : "cotizacion", detalle: limpio(b.detalle, 500) || "Agregado desde el tablero" };
  if (p.nombre.length < 2) throw new Rechazo("Escribe el nombre de la persona.");
  if (p.correo && !CORREO.test(p.correo)) throw new Rechazo("Revisa el correo o déjalo en blanco.");
  if (p.telefono.replace(/\D/g, "").length < 7 && !p.correo) throw new Rechazo("Escribe un teléfono o un correo para contactarla.");
  return p;
}

export function crearManejadorProspectos({ almacen, auth = almacen, config = {}, exigirMfa = true, ahora = () => Date.now() }) {
  async function autorizar(request) {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const usuario = token ? await auth.usuarioDeToken(token) : null;
    if (!usuario) return { no: json({ error: "Inicia sesión" }, 401) };
    if (!usuario.email_confirmed_at) return { no: json({ error: "Tu cuenta aún no confirmó su correo" }, 403) };
    if (exigirMfa && usuario.aal !== "aal2") return { no: json({ error: "Ingresa el código de tu app de verificación", mfa: true }, 401) };
    if (!(await auth.esPersonal(usuario.email))) return { no: json({ error: "Tu cuenta no tiene acceso al tablero de ventas." }, 403) };
    return { email: String(usuario.email).toLowerCase() };
  }
  async function ejecutar(accion, objetivo, email, fn) {
    let ok = true;
    try { return json(await fn()); }
    catch (e) {
      ok = false;
      if (e instanceof Rechazo) return json({ error: e.message }, 400);
      console.error(`Prospectos: error en "${accion}":`, e?.message || e);
      return json({ error: GENERICO }, 500);
    } finally {
      await auth.auditar({ email, accion: "prospectos." + accion, objetivo: String(objetivo ?? "").slice(0, 80), ok }).catch((e) => console.error("Auditoría no registrada:", e?.message));
    }
  }

  return {
    async GET(request) {
      if (new URL(request.url).searchParams.get("accion") === "config")
        return json({ supabaseUrl: config.supabaseUrl || "", supabaseAnonKey: config.supabaseAnonKey || "", mfa: exigirMfa });
      const a = await autorizar(request); if (a.no) return a.no;
      try { return json({ prospectos: await almacen.prospectos(), planes: PRECIOS_PLANES, email: a.email }); }
      catch (e) { console.error("Prospectos: error al listar:", e?.message || e); return json({ error: GENERICO }, 500); }
    },
    async POST(request) {
      const a = await autorizar(request); if (a.no) return a.no;
      let b; try { b = await request.json(); } catch { return json({ error: "JSON inválido" }, 400); }
      const t = ahora(), firma = { actualizado: new Date(t).toISOString(), actualizadoPor: a.email };
      if (b?.accion === "actualizar") return ejecutar("actualizar", b.id, a.email, async () => {
        const actual = (await almacen.prospectos()).find((p) => p.id === String(b.id));
        if (!actual) throw new Rechazo("Ese prospecto ya no existe.");
        const prospecto = await almacen.actualizarProspecto(actual.id, { ...validarCambios(b.cambios || {}, actual, hoyEnQuito(t)), ...firma });
        return { prospecto };
      });
      if (b?.accion === "crear") return ejecutar("crear", "", a.email, async () => {
        const nuevo = await almacen.guardarProspecto({ conversacionId: null, ...validarNuevo(b) });
        return { prospecto: await almacen.actualizarProspecto(nuevo.id, firma) };
      });
      return json({ error: "Acción desconocida" }, 400);
    }
  };
}
