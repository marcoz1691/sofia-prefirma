import { describe, it, expect, vi } from "vitest";
import { crearProveedorPagoMedios, desglose, tipoDocumento } from "../api/_lib/pagos/pagomedios.js";
import { obtenerProveedorPagos } from "../api/_lib/pagos/proveedor.js";
import { crearManejadorVentas } from "../api/_lib/ventas-http.js";
import { crearAlmacenMemoria } from "../api/_lib/almacen-memoria.js";

const SECRETO = "s".repeat(40);
function apiFalsa({ estado = 0, monto = null } = {}) {
  const llamadas = [];
  const fetch = vi.fn(async (url, opciones) => {
    llamadas.push({ url, ...opciones, cuerpo: opciones.body ? JSON.parse(opciones.body) : null });
    if (opciones.method === "POST") return Response.json({ success: true, status: 200, data: { token: "cha_PRUEBA123", url: "https://payurl.link/ABC" } });
    return Response.json({ success: true, status: 200, data: [{ id: "cha_PRUEBA123", status: estado, amount: monto, auth_code: estado === 1 ? "A1" : null }] });
  });
  return { fetch, llamadas };
}

describe("PagoMedios", () => {
  it("separa base e IVA y reconoce cédula o RUC", () => {
    expect(desglose(13685)).toEqual({ total: 136.85, base: 119, impuesto: 17.85 });
    expect(tipoDocumento("1716163660")).toBe("05");
    expect(tipoDocumento("1716163660001")).toBe("04");
  });

  it("crea la solicitud de pago con Bearer, el desglose y un enlace de aviso firmado", async () => {
    const { fetch, llamadas } = apiFalsa();
    const p = crearProveedorPagoMedios({ token: "token-de-prueba", secreto: SECRETO, fetch });
    const urlAviso = p.enlaceAviso("https://sofiaprefirma.com/api/ventas?aviso=plan", "pago-1");
    const r = await p.crearOrden({ pago: { id: "pago-1", montoCentavos: 13685, concepto: "Plan PreFirma" }, pagador: { documento: "1716163660", nombre: "Lucía", correo: "l@x.ec", celular: "0991234567" }, urlAviso });
    expect(r).toEqual({ orden: "cha_PRUEBA123|https://payurl.link/ABC", urlCheckout: "https://payurl.link/ABC" });
    const [c] = llamadas;
    expect(c.url).toBe("https://api.abitmedia.cloud/pagomedios/v2/payment-requests");
    expect(c.headers.Authorization).toBe("Bearer token-de-prueba");
    expect(c.cuerpo).toMatchObject({ amount: 136.85, amount_with_tax: 119, tax_value: 17.85, custom_value: "pago-1", notify_url: urlAviso,
      third: { document: "1716163660", document_type: "05", type: "Individual" } });
  });

  it("consulta el estado y traduce los códigos de PagoMedios", async () => {
    const { fetch } = apiFalsa({ estado: 1, monto: 136.85 });
    const p = crearProveedorPagoMedios({ token: "token-de-prueba", secreto: SECRETO, fetch });
    expect(await p.consultarPago({ orden: "cha_PRUEBA123|https://payurl.link/ABC" })).toMatchObject({ estado: "pagado", monto: 13685, moneda: "USD" });
    expect(fetch.mock.calls[0][0]).toBe("https://api.abitmedia.cloud/pagomedios/v2/payment-requests?id=cha_PRUEBA123");
  });

  it("rechaza avisos sin nuestra firma", async () => {
    const p = crearProveedorPagoMedios({ token: "token-de-prueba", secreto: SECRETO, fetch: vi.fn() });
    const bueno = p.enlaceAviso("https://sofiaprefirma.com/api/ventas?aviso=plan", "pago-1");
    expect(await p.procesarWebhook(new Request(bueno, { method: "POST", body: "{}" }))).toMatchObject({ valido: true, consultar: true, pagoId: "pago-1" });
    const malo = bueno.replace(/firma=[0-9a-f]+/, "firma=" + "0".repeat(64));
    expect((await p.procesarWebhook(new Request(malo, { method: "POST", body: "{}" }))).valido).toBe(false);
  });

  it("se activa solo con su token y un secreto", () => {
    expect(obtenerProveedorPagos({ PAGOS_PROVEEDOR: "pagomedios", PAGOMEDIOS_TOKEN: "token-de-prueba", PAGOS_SECRETO: SECRETO })?.nombre).toBe("pagomedios");
    expect(obtenerProveedorPagos({ PAGOS_PROVEEDOR: "pagomedios", PAGOMEDIOS_TOKEN: "token-de-prueba" })).toBe(null);
  });
});

describe("pago en línea del plan", () => {
  const pedir = (cuerpo, url = "https://sofiaprefirma.com/api/ventas") => new Request(url, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "190.1.1.1" }, body: JSON.stringify(cuerpo) });
  const datos = { accion: "pagar", nombre: "Lucía Andrade", notaria: "Notaría 12", telefono: "0991234567", plan: "PreFirma", periodo: "mensual", documento: "1716163660", aceptaTerminos: true, aceptaDatos: true };

  it("fija el monto en el servidor, abre PagoMedios y avisa una sola vez cuando el pago se confirma", async () => {
    const almacen = crearAlmacenMemoria(), avisar = vi.fn(async () => {});
    const api = apiFalsa();
    const proveedor = crearProveedorPagoMedios({ token: "token-de-prueba", secreto: SECRETO, fetch: api.fetch });
    const m = crearManejadorVentas({ agente: {}, almacen, avisar, proveedor });
    const r = await (await m.POST(pedir({ ...datos, totalCentavos: 1 }))).json();
    expect(r).toMatchObject({ urlCheckout: "https://payurl.link/ABC", totalCentavos: 13685 });
    expect((await almacen.pagoPlan(r.id)).estado).toBe("pendiente");

    expect(await (await m.POST(pedir({ accion: "estadoPago", id: r.id }))).json()).toMatchObject({ estado: "pendiente" });
    api.fetch.mockImplementation(async (url, o) => Response.json({ success: true, data: [{ status: 1, amount: 136.85 }] }));
    const aviso = proveedor.enlaceAviso("https://sofiaprefirma.com/api/ventas?aviso=plan", r.id);
    expect((await m.POST(new Request(aviso, { method: "POST", body: "id=cha" }))).status).toBe(200);
    expect(await (await m.POST(pedir({ accion: "estadoPago", id: r.id }))).json()).toMatchObject({ estado: "pagado", plan: "PreFirma" });
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0][0]).toContain("Pago recibido en SOFIA PreFirma: plan PreFirma (mensual), USD 136.85");
  });

  it("no acepta un pago con monto distinto ni sin cédula o RUC", async () => {
    const almacen = crearAlmacenMemoria(), avisar = vi.fn(async () => {});
    const api = apiFalsa({ estado: 1, monto: 1 });
    const m = crearManejadorVentas({ agente: {}, almacen, avisar, proveedor: crearProveedorPagoMedios({ token: "token-de-prueba", secreto: SECRETO, fetch: api.fetch }) });
    expect((await m.POST(pedir({ ...datos, documento: "123" }))).status).toBe(400);
    const r = await (await m.POST(pedir(datos))).json();
    expect(await (await m.POST(pedir({ accion: "estadoPago", id: r.id }))).json()).toMatchObject({ estado: "pendiente" });
    expect(avisar).not.toHaveBeenCalled();
  });

  it("sin pasarela configurada explica que el asesor enviará el enlace", async () => {
    const m = crearManejadorVentas({ agente: {}, almacen: crearAlmacenMemoria() });
    const r = await m.POST(pedir(datos));
    expect(r.status).toBe(404);
    expect((await r.json()).error).toContain("Un asesor te enviará el enlace de pago");
  });
});
