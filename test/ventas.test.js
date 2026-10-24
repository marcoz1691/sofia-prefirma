import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { crearAgenteVentas } from "../api/_lib/ventas.js";
import { crearManejadorVentas } from "../api/_lib/ventas-http.js";
import { PLANES, sistemaVentas } from "../api/_lib/catalogo-ventas.js";
import { crearAlmacenMemoria } from "../api/_lib/almacen-memoria.js";
import { AVISO_PRIVACIDAD_PREFIRMA } from "../js/legal.js";
import middleware from "../middleware.js";

function claudeFalso(guion) {
  const create = vi.fn(async (params) => {
    const r = guion.shift();
    if (!r) throw new Error("guion agotado");
    return structuredClone(r);
  });
  return { beta: { messages: { create } } };
}
const texto = (t) => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }], usage: { input_tokens: 10, output_tokens: 5 } });
const herramienta = (input) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "registrar_interes", input }] });
const SESION = "s_7f3a9c2e41b84d0f00112233";

let almacen, avisar;
beforeEach(() => { almacen = crearAlmacenMemoria(); avisar = vi.fn(async () => {}); });

describe("agente de ventas", () => {
  it("responde con el catálogo de SOFIA PreFirma y guarda la conversación", async () => {
    const claude = claudeFalso([texto("El plan PreFirma cuesta USD 119 al mes más IVA.")]);
    const agente = crearAgenteVentas({ claude, almacen, avisar });
    expect(await agente.atender({ sesion: SESION, texto: "¿Cuánto cuesta PreFirma?" })).toEqual(["El plan PreFirma cuesta USD 119 al mes más IVA."]);
    const params = claude.beta.messages.create.mock.calls[0][0];
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.fallbacks).toBe("default");
    expect(params.tools.map((t) => t.name)).toEqual(["registrar_interes"]);
    expect(params.system[0].text).toContain("PreFirma (Prepara expedientes, el más elegido): USD 119 al mes");
    const conv = await almacen.conversacionPorTelefono("web:" + SESION);
    expect((await almacen.historial(conv.id)).length).toBe(2);
  });

  it("registra al interesado, avisa al asesor y no pide datos sensibles", async () => {
    const claude = claudeFalso([
      herramienta({ nombre: "Lucía Andrade", notaria: "Notaría 12", ciudad: "Cuenca", telefono: "099 123 4567", motivo: "demostracion", plan: "Equipo" }),
      texto("Listo, Lucía. Un asesor te escribirá para coordinar la demostración.")
    ]);
    const agente = crearAgenteVentas({ claude, almacen, avisar });
    const r = await agente.atender({ sesion: SESION, texto: "Quiero una demo, soy Lucía de la Notaría 12 de Cuenca, 099 123 4567" });
    expect(r).toEqual(["Listo, Lucía. Un asesor te escribirá para coordinar la demostración."]);
    const [p] = await almacen.prospectos();
    expect(p).toMatchObject({ nombre: "Lucía Andrade", notaria: "Notaría 12", ciudad: "Cuenca", telefono: "099 123 4567", motivo: "demostracion", plan: "Equipo" });
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining("Nuevo interesado en SOFIA PreFirma (demostracion): Lucía Andrade · Notaría 12, Cuenca · plan Equipo · 099 123 4567"));
    expect(sistemaVentas()).toContain("nunca pidas cédulas");
  });

  it("pasa al modelo avanzado si la persona reporta un problema o pregunta por el contrato", async () => {
    const claude = claudeFalso([texto("Lo reviso.")]);
    await crearAgenteVentas({ claude, almacen, avisar }).atender({ sesion: SESION, texto: "Somos clientes y el WhatsApp no funciona desde ayer" });
    expect(claude.beta.messages.create.mock.calls[0][0].model).toBe("claude-opus-5-5");
  });

  it("no registra sin un teléfono o correo válido y se lo explica al modelo", async () => {
    const claude = claudeFalso([herramienta({ nombre: "Pedro", correo: "no-es-correo", motivo: "cotizacion" }), texto("¿Me das un teléfono o correo?")]);
    await crearAgenteVentas({ claude, almacen, avisar }).atender({ sesion: SESION, texto: "cotízame" });
    expect(await almacen.prospectos()).toEqual([]);
    expect(avisar).not.toHaveBeenCalled();
    const resultado = claude.beta.messages.create.mock.calls[1][0].messages.at(-1).content[0];
    expect(resultado).toMatchObject({ type: "tool_result", is_error: true });
    expect(resultado.content).toContain("Falta un teléfono o un correo");
  });

  it("si Claude falla, se disculpa y deja la conversación guardada", async () => {
    const claude = { beta: { messages: { create: vi.fn(async () => { throw Object.assign(new Error("caído"), { status: 500 }); }) } } };
    const r = await crearAgenteVentas({ claude, almacen, avisar }).atender({ sesion: SESION, texto: "hola" });
    expect(r[0]).toContain("Disculpa");
  });

  it("los precios del catálogo coinciden con los de la página comercial", () => {
    const html = readFileSync(new URL("../propuesta-sofia.html", import.meta.url), "utf8");
    const enPagina = [...html.matchAll(/data-mensual="(\d+)" data-plan="([^"]+)"/g)].map((m) => [m[2], Number(m[1])]);
    expect(PLANES.map((p) => [p.nombre, p.mensual])).toEqual(enPagina);
  });
});

describe("API del chat de ventas", () => {
  const pedir = (body, ip = "190.152.10.20") => new Request("https://sofiaprefirma.com/api/ventas", {
    method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ aceptaTerminos: true, aceptaDatos: true, ...body })
  });
  const preparar = (limites) => {
    const agente = { atender: vi.fn(async () => ["Hola, soy Sofía."]) };
    return { agente, m: crearManejadorVentas({ agente, almacen, ahora: () => 1_000_000, limites: limites || { porSesion: 2, porIp: 5, porDia: 100 } }) };
  };

  it("responde y deja constancia del consentimiento con los textos de SOFIA PreFirma", async () => {
    const { m, agente } = preparar();
    const r = await m.POST(pedir({ sesion: SESION, texto: "hola" }));
    expect(await r.json()).toEqual({ respuestas: ["Hola, soy Sofía."] });
    expect(agente.atender).toHaveBeenCalledWith({ sesion: SESION, texto: "hola" });
    const [c] = await almacen.consentimientos();
    expect(c).toMatchObject({ canal: "chat-ventas", aviso: AVISO_PRIVACIDAD_PREFIRMA });
  });

  it("pide las dos casillas antes del primer mensaje", async () => {
    const { m, agente } = preparar();
    const r = await m.POST(pedir({ sesion: SESION, texto: "hola", aceptaDatos: false }));
    expect(r.status).toBe(400);
    expect((await r.json()).aceptacion).toBe(true);
    expect(agente.atender).not.toHaveBeenCalled();
  });

  it("rechaza sesiones y textos inválidos y limita los mensajes por sesión", async () => {
    const { m } = preparar();
    expect((await m.POST(pedir({ sesion: "x", texto: "hola" }))).status).toBe(400);
    expect((await m.POST(pedir({ sesion: SESION, texto: "a".repeat(1001) }))).status).toBe(400);
    for (let i = 0; i < 2; i++) expect((await m.POST(pedir({ sesion: SESION, texto: "hola" }))).status).toBe(200);
    expect((await m.POST(pedir({ sesion: SESION, texto: "hola" }))).status).toBe(429);
  });

  it("«Elegir plan» guarda la solicitud del mes gratis, deja constancia y avisa sin llamar a Claude", async () => {
    const avisar = vi.fn(async () => {});
    const agente = { atender: vi.fn() };
    const m = crearManejadorVentas({ agente, almacen, avisar, ahora: () => 1_000_000 });
    const datos = { accion: "solicitar", nombre: "Lucía Andrade", notaria: "Notaría 12", ciudad: "Cuenca", cargo: "Notario o notaria", telefono: "099 123 4567", plan: "Equipo", periodo: "anual" };
    expect((await m.POST(pedir({ ...datos, telefono: "12" }))).status).toBe(400);
    expect((await m.POST(pedir({ ...datos, plan: "Gratis" }))).status).toBe(400);
    expect((await m.POST(pedir({ ...datos, aceptaDatos: false }))).status).toBe(400);
    const r = await m.POST(pedir(datos));
    expect(await r.json()).toEqual({ ok: true, plan: "Equipo", periodo: "anual" });
    const [p] = await almacen.prospectos();
    expect(p).toMatchObject({ nombre: "Lucía Andrade", plan: "Equipo", motivo: "contratar", detalle: "Mes de prueba gratis · pago anual" });
    expect((await almacen.consentimientos())[0]).toMatchObject({ canal: "formulario-ventas", aviso: AVISO_PRIVACIDAD_PREFIRMA });
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining("Nueva solicitud de SOFIA PreFirma: plan Equipo"));
    expect(agente.atender).not.toHaveBeenCalled();
  });

  it("se apaga con el interruptor del chat web del tenant de ventas", async () => {
    await almacen.guardarAjuste("funcion.chatWeb", "0", "admin");
    const { m } = preparar();
    expect((await m.POST(pedir({ sesion: SESION, texto: "hola" }))).status).toBe(503);
  });
});

describe("middleware del sitio comercial", () => {
  it("deja pasar solo /api/ventas y los archivos del chat", async () => {
    const anterior = process.env.SOFIA_MODO;
    process.env.SOFIA_MODO = "comercial";
    try {
      const ok = async (ruta) => (await middleware(new Request("https://preview.example" + ruta))).headers.get("x-middleware-next");
      expect(await ok("/api/ventas")).toBe("1");
      for (const ruta of ["/js/ventas-chat.js", "/js/chat-nucleo.js", "/js/aceptacion.js", "/js/legal.js", "/prefirma-privacidad.html", "/prefirma-terminos.html"]) expect(await ok(ruta)).toBe("1");
      expect((await middleware(new Request("https://preview.example/api/chat"))).status).toBe(404);
    } finally {
      if (anterior === undefined) delete process.env.SOFIA_MODO; else process.env.SOFIA_MODO = anterior;
    }
  });
});
