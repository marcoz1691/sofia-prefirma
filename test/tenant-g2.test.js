import { afterEach, describe, expect, it, vi } from "vitest";
import { crearAlmacenMemoria } from "../api/_lib/almacen-memoria.js";
import { crearCorreoMemoria } from "../api/_lib/correo.js";
import { crearManejadorCuenta } from "../api/_lib/cuenta-http.js";
import { crearManejadorPanel } from "../api/_lib/panel-http.js";
import { crearManejadorCita } from "../api/_lib/cita-http.js";
import { crearManejadorDocumentos } from "../api/_lib/documentos-http.js";

const TENANT = "notaria41";
const AJENA = "notaria-sur";
const AHORA = Date.parse("2026-10-12T12:00:00Z");
const PDF = Buffer.from("%PDF-1.7").toString("base64");

// G2: el tenant pertenece a la configuración del despliegue, no a datos controlados por el navegador.
const URL_HOSTIL = `https://${AJENA}.sofiaprefirma.com/api/recurso?notariaId=${AJENA}&tenant=${AJENA}`;
const cabecerasHostiles = {
  "x-forwarded-host": `${AJENA}.sofiaprefirma.com`,
  "x-forwarded-for": "203.0.113.9, 10.0.0.1",
};

afterEach(() => vi.unstubAllEnvs());

const contenidoCita = {
  notaria: { direccion: "Quito", horario: { dias: [1, 2, 3, 4, 5], abre: "08:00", cierra: "17:00", texto: "Lunes a viernes" }, citas: { porHora: 2, feriados: [] } },
  data: { tramites: [{ id: "poder", nombre: "Poder", cat: "poderes", req: ["Cédula"], tarifa: { tipo: "fija", valor: 10 } }] },
  tarifas: { iva: 0.15 },
};

function cuentaPost(body, cookie = "") {
  return new Request(URL_HOSTIL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sofia": "1",
      origin: `https://${AJENA}.sofiaprefirma.com`,
      cookie,
      ...cabecerasHostiles,
    },
    body: JSON.stringify(body),
  });
}

describe("Puerta G2: el navegador no puede escoger la notaría", () => {
  it("cuenta: cuerpo, query, host y cabeceras reenviadas no mueven OTP ni sesión a otra notaría", async () => {
    vi.stubEnv("NOTARIA_ID", TENANT);
    const almacen = crearAlmacenMemoria();
    const correo = crearCorreoMemoria();
    await almacen.guardarAjuste("funcion.portal", "1", "prueba");
    const contarUso = vi.spyOn(almacen, "contarUso");
    const api = crearManejadorCuenta({ almacen, correo, contenido: async () => ({ notaria: { nombre: "Notaría 41" } }), ahora: () => AHORA,
      secreto: "secreto-de-pruebas-largo-y-unico-para-g2" });

    const email = "g2@example.test";
    expect((await api.POST(cuentaPost({ accion: "pedirCodigo", email, notariaId: AJENA, tenant: AJENA }))).status).toBe(202);
    expect(contarUso.mock.calls.every(([clave]) => clave.includes(`cuenta:${TENANT}:`))).toBe(true);
    const codigo = correo.enviados[0].texto.match(/\b\d{6}\b/)[0];
    const entrada = await api.POST(cuentaPost({ accion: "verificar", email, codigo, notariaId: AJENA, tenant: AJENA }));
    expect(entrada.status).toBe(200);
    expect(await almacen.clientePorEmail(TENANT, email)).toEqual(expect.objectContaining({ notariaId: TENANT }));
    expect(await almacen.clientePorEmail(AJENA, email)).toBeNull();
  });

  it("panel: un host/query/cuerpo reenviado no cambia el almacén ni eleva el tenant", async () => {
    vi.stubEnv("NOTARIA_ID", TENANT);
    const almacen = crearAlmacenMemoria({ personal: [{ email: "personal@example.test", nombre: "Persona", rol: "admin" }] });
    const panel = {
      detalle: vi.fn(async (id) => ({ id, notariaId: TENANT })),
      responder: vi.fn(async () => {}),
    };
    const auth = Object.assign(almacen, {
      usuarioDeToken: vi.fn(async () => ({ email: "personal@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", aal: "aal2" })),
      esPersonal: vi.fn(async () => true),
      rolDe: vi.fn(async () => "admin"),
    });
    const api = crearManejadorPanel({ panel, auth, exigirMfa: false });
    const request = new Request(`${URL_HOSTIL}&accion=detalle&id=real`, {
      headers: { Authorization: "Bearer TOKEN", ...cabecerasHostiles },
    });
    const result = await api.GET(request);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ id: "real", notariaId: TENANT });
    expect(panel.detalle).toHaveBeenCalledWith("real");
    expect(auth.usuarioDeToken).toHaveBeenCalledWith("TOKEN");
    expect(JSON.stringify(auth.usuarioDeToken.mock.calls)).not.toContain(AJENA);

    const cambio = await api.POST(new Request(URL_HOSTIL, {
      method: "POST", headers: { Authorization: "Bearer TOKEN", "content-type": "application/json", ...cabecerasHostiles },
      body: JSON.stringify({ accion: "responder", id: "real", texto: "hola", notariaId: AJENA, tenant: AJENA }),
    }));
    expect(cambio.status).toBe(200);
    expect(panel.responder).toHaveBeenCalledWith("real", "hola");
    expect(JSON.stringify(panel.responder.mock.calls)).not.toContain(AJENA);
  });

  it("cita: no acepta notariaId del cuerpo/query ni host o x-forwarded-host para registrar el evento", async () => {
    vi.stubEnv("NOTARIA_ID", TENANT);
    const almacen = crearAlmacenMemoria();
    const registrarEvento = vi.spyOn(almacen, "registrarEventoTramite");
    const api = crearManejadorCita({ almacen, contenido: async () => contenidoCita, ahora: () => new Date(AHORA) });
    const body = {
      nombre: "Ana Pérez", celular: "0991234567", tramiteId: "poder", fecha: "2026-10-13", hora: "09:30",
      aceptaTerminos: true, aceptaDatos: true, notariaId: AJENA, tenant: AJENA,
    };
    const result = await api.POST(new Request(`${URL_HOSTIL}&notaria=${AJENA}`, {
      method: "POST", headers: { "content-type": "application/json", ...cabecerasHostiles }, body: JSON.stringify(body),
    }));
    expect(result.status).toBe(201);
    const [cita] = await almacen.citasEntre("2026-10-13", "2026-10-13");
    expect(cita.notariaId).toBe(TENANT);
    expect(registrarEvento).toHaveBeenCalledWith(expect.objectContaining({ notariaId: TENANT, solicitudId: cita.id }));
    expect(registrarEvento.mock.calls.flatMap(([e]) => Object.values(e))).not.toContain(AJENA);
  });

  it("documentos: no acepta notariaId del cuerpo/query ni host o x-forwarded-host para el documento/evento", async () => {
    vi.stubEnv("NOTARIA_ID", TENANT);
    const almacen = crearAlmacenMemoria();
    const conv = await almacen.conversacion("web:g2-sesion-123", "Ana Pérez");
    const cita = await almacen.crearSolicitudCita({ conversacionId: conv.id, fecha: "2026-10-13", codigo: "4821", nombre: "Ana Pérez", tramiteId: "poder" });
    await almacen.actualizarCita(cita.id, { codigo: "4821" });
    const registrarEvento = vi.spyOn(almacen, "registrarEventoTramite");
    const api = crearManejadorDocumentos({ almacen, ahora: () => AHORA });
    const body = {
      sesion: "g2-sesion-123", ticket: "4821", descripcion: "Cédula", nombre: "cedula.pdf", base64: PDF,
      aceptaTerminos: true, aceptaDatos: true, notariaId: AJENA, tenant: AJENA,
    };
    const result = await api.POST(new Request(`${URL_HOSTIL}&ticket=4821&notaria=${AJENA}`, {
      method: "POST", headers: { "content-type": "application/json", ...cabecerasHostiles }, body: JSON.stringify(body),
    }));
    expect(result.status).toBe(200);
    const [documento] = await almacen.documentos(conv.id);
    expect(documento.solicitudId).toBe(cita.id);
    expect(registrarEvento).toHaveBeenCalledWith(expect.objectContaining({ notariaId: TENANT, solicitudId: cita.id }));
    expect(registrarEvento.mock.calls.flatMap(([e]) => Object.values(e))).not.toContain(AJENA);
  });
});
