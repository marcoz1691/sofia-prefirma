import { describe, it, expect, vi } from "vitest";
import { crearManejadorProspectos, validarCambios, PRECIOS_PLANES } from "../api/_lib/prospectos-http.js";
import { crearAlmacenMemoria } from "../api/_lib/almacen-memoria.js";
import middleware from "../middleware.js";

const CONFIRMADO = "2026-11-01T00:00:00Z";
const AHORA = Date.parse("2026-11-19T15:00:00Z");
async function preparar({ usuario = { email: "Ventas@Sofia.ec", email_confirmed_at: CONFIRMADO, aal: "aal2" }, esPersonal = true, exigirMfa = true } = {}) {
  const almacen = crearAlmacenMemoria();
  const auth = Object.assign(almacen, { usuarioDeToken: vi.fn(async (t) => (t === "TOKEN" ? usuario : null)), esPersonal: vi.fn(async () => esPersonal), auditar: vi.fn(async () => {}) });
  const p = await almacen.guardarProspecto({ conversacionId: null, nombre: "Luis Andrade", notaria: "Notaría 12", ciudad: "Cuenca", cargo: "Notario", telefono: "0991234567", correo: "", plan: "Esencial", motivo: "cotizacion", detalle: "Quiere precios" });
  const m = crearManejadorProspectos({ almacen, auth, config: { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon" }, exigirMfa, ahora: () => AHORA });
  return { m, almacen, auth, id: p.id };
}
const req = (metodo, { token = "TOKEN", body, query = "" } = {}) => new Request("https://sofiaprefirma.com/api/prospectos" + query, {
  method: metodo, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" }, body: body && JSON.stringify(body)
});

describe("API del tablero de prospectos", () => {
  it("entrega la configuración pública sin sesión", async () => {
    const { m } = await preparar();
    const r = await m.GET(req("GET", { token: null, query: "?accion=config" }));
    expect(await r.json()).toEqual({ supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon", mfa: true });
  });

  it("exige sesión, verificación en dos pasos y ser del equipo de ventas", async () => {
    expect((await (await preparar()).m.GET(req("GET", { token: null }))).status).toBe(401);
    const sinMfa = await (await preparar({ usuario: { email: "a@b.ec", email_confirmed_at: CONFIRMADO, aal: "aal1" } })).m.GET(req("GET"));
    expect(sinMfa.status).toBe(401);
    expect((await sinMfa.json()).mfa).toBe(true);
    const ajeno = await (await preparar({ esPersonal: false })).m.GET(req("GET"));
    expect(ajeno.status).toBe(403);
    expect((await ajeno.json()).error).toMatch(/tablero de ventas/);
  });

  it("lista los prospectos con valores de seguimiento por defecto y los precios de los planes", async () => {
    const { m } = await preparar();
    const r = await (await m.GET(req("GET"))).json();
    expect(r.email).toBe("ventas@sofia.ec");
    expect(r.planes).toEqual(PRECIOS_PLANES);
    expect(r.prospectos[0]).toMatchObject({ nombre: "Luis Andrade", etapa: "nuevo", contrato: "no_enviado", pago: "pendiente", firmadoEn: null, valorMensual: null, notas: "" });
  });

  it("al firmar el contrato marca la fecha, gana el prospecto y deja rastro de quién lo cambió", async () => {
    const { m, auth, id } = await preparar();
    const r = await m.POST(req("POST", { body: { accion: "actualizar", id, cambios: { contrato: "firmado" } } }));
    expect(r.status).toBe(200);
    const { prospecto } = await r.json();
    expect(prospecto).toMatchObject({ contrato: "firmado", etapa: "ganado", firmadoEn: "2026-11-19", actualizadoPor: "ventas@sofia.ec" });
    expect(auth.auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: "prospectos.actualizar", objetivo: id, ok: true }));
    const vuelto = await (await m.POST(req("POST", { body: { accion: "actualizar", id, cambios: { contrato: "enviado" } } }))).json();
    expect(vuelto.prospecto).toMatchObject({ contrato: "enviado", firmadoEn: null });
  });

  it("rechaza valores fuera de lo permitido sin tocar el prospecto", async () => {
    const { m, almacen, id } = await preparar();
    for (const cambios of [{ etapa: "regalado" }, { valorMensual: -5 }, { proximoEn: "19/11/2026" }, {}]) {
      expect((await m.POST(req("POST", { body: { accion: "actualizar", id, cambios } }))).status).toBe(400);
    }
    expect((await m.POST(req("POST", { body: { accion: "actualizar", id: "no-existe", cambios: { pago: "pagado" } } }))).status).toBe(400);
    expect((await almacen.prospectos())[0]).toMatchObject({ etapa: "nuevo", valorMensual: null, proximoEn: null });
  });

  it("solo guarda los campos conocidos y limpia los textos", () => {
    const c = validarCambios({ notas: "  hola\u0007 ", proximoPaso: "Llamar\nel lunes", valorMensual: "49.999", id: "otro", notaria_id: "x" }, { contrato: "no_enviado" }, "2026-11-19");
    expect(c).toEqual({ notas: "hola", proximoPaso: "Llamar el lunes", valorMensual: 50 });
  });

  it("agrega un prospecto a mano y pide un medio de contacto", async () => {
    const { m, almacen } = await preparar();
    expect((await m.POST(req("POST", { body: { accion: "crear", nombre: "Sin contacto" } }))).status).toBe(400);
    const r = await m.POST(req("POST", { body: { accion: "crear", nombre: "Marta Ríos", correo: "Marta@Notaria.ec", plan: "Pro", motivo: "inventado" } }));
    expect(r.status).toBe(200);
    expect((await r.json()).prospecto).toMatchObject({ nombre: "Marta Ríos", correo: "marta@notaria.ec", motivo: "cotizacion", etapa: "nuevo", actualizadoPor: "ventas@sofia.ec" });
    expect(await almacen.prospectos()).toHaveLength(2);
  });
});

describe("tablero en el sitio comercial", () => {
  it("abre /ventas/ y su API, pero el panel de la notaría sigue cerrado", async () => {
    const anterior = process.env.SOFIA_MODO;
    process.env.SOFIA_MODO = "comercial";
    try {
      const pasa = async (ruta) => (await middleware(new Request("https://sofiaprefirma.com" + ruta))).headers.get("x-middleware-next");
      for (const ruta of ["/ventas/", "/js/ventas.js", "/css/ventas.css", "/api/prospectos", "/panel/vendor/supabase-js-2.117.2.js"]) expect(await pasa(ruta)).toBe("1");
      const corta = await middleware(new Request("https://sofiaprefirma.com/ventas"));
      expect(corta.status).toBe(308);
      expect(corta.headers.get("location")).toBe("https://sofiaprefirma.com/ventas/");
      for (const ruta of ["/panel/", "/api/panel", "/js/panel.js"]) expect((await middleware(new Request("https://sofiaprefirma.com" + ruta))).status).toBe(404);
    } finally {
      if (anterior === undefined) delete process.env.SOFIA_MODO; else process.env.SOFIA_MODO = anterior;
    }
  });
});
