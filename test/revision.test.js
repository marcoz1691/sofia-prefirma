// Regresiones de la revisión de código del 2026-10-23.
import { it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { crearManejadorTurnos, llamarSiguiente, marcarTurno, filaDelDia } from "../api/_lib/turnos.js";
import { crearManejadorVentas } from "../api/_lib/ventas-http.js";
import { crearProveedorPagoMedios } from "../api/_lib/pagos/pagomedios.js";
import { crearAlmacenMemoria } from "../api/_lib/almacen-memoria.js";
import { Aviso } from "../api/_lib/errores.js";

const AHORA = Date.parse("2026-10-23T15:00:00Z");
const esquema = readFileSync(new URL("../supabase/esquema.sql", import.meta.url), "utf8");

it("el bloque del turnero es SQL válido y los canales nuevos de consentimiento están permitidos", () => {
  const turnos = esquema.slice(esquema.indexOf("create table if not exists turnos ("), esquema.indexOf("create index if not exists turnos_notaria_fecha"));
  expect(turnos.match(/motivo text/g)).toHaveLength(1);
  expect(turnos).toContain("celular text check (celular ~ '^[0-9]{11,13}$'),");
  expect((turnos.match(/\(/g) || []).length).toBe((turnos.match(/\)/g) || []).length);
  const canales = esquema.slice(esquema.lastIndexOf("add constraint consentimientos_canal_check"));
  for (const c of ["chat-ventas", "formulario-ventas", "pago-plan", "turnero"]) expect(canales).toContain(`'${c}'`);
});

it("el personal solo puede mover un turno por transiciones permitidas y ve el motivo si no", async () => {
  const almacen = crearAlmacenMemoria();
  await almacen.guardarAjuste("funcion.turnero", "1", "admin");
  const m = crearManejadorTurnos({ almacen, ahora: () => AHORA });
  await m.POST(new Request("https://n.ec/api/turnos", { method: "POST", headers: { "x-forwarded-for": "1.1.1.1" },
    body: JSON.stringify({ accion: "tomar", nombre: "Ana Pérez", aceptaTerminos: true, aceptaDatos: true }) }));
  await llamarSiguiente(almacen, { ventanilla: "1", ahora: AHORA });
  const id = (await filaDelDia(almacen, AHORA)).turnos[0].id;
  await marcarTurno(almacen, { id, estado: "atendido" }, AHORA);
  await expect(marcarTurno(almacen, { id, estado: "esperando" }, AHORA)).rejects.toBeInstanceOf(Aviso);
  await expect(marcarTurno(almacen, { id: "x", estado: "atendido" }, AHORA)).rejects.toBeInstanceOf(Aviso);
});

it("el chat de ventas cuenta cada conversación nueva una sola vez", async () => {
  const almacen = crearAlmacenMemoria();
  const m = crearManejadorVentas({ agente: { atender: async () => ["Hola"] }, almacen, ahora: () => AHORA });
  const pedir = () => new Request("https://sofiaprefirma.com/api/ventas", { method: "POST", headers: { "x-forwarded-for": "1.1.1.1" },
    body: JSON.stringify({ sesion: "s_0123456789abcdef01234567", texto: "hola", aceptaTerminos: true, aceptaDatos: true }) });
  await m.POST(pedir()); await m.POST(pedir());
  expect((await almacen.metricas("2026-10-23", "2026-10-23")).find((f) => f.clave === "conv.nueva.web")?.valor).toBe(1);
});

it("pagar un plan deja constancia del consentimiento", async () => {
  const almacen = crearAlmacenMemoria();
  const fetch = vi.fn(async () => Response.json({ success: true, data: { token: "cha_X", url: "https://payurl.link/X" } }));
  const m = crearManejadorVentas({ agente: {}, almacen, proveedor: crearProveedorPagoMedios({ token: "token-de-prueba", secreto: "s".repeat(40), fetch }), ahora: () => AHORA });
  await m.POST(new Request("https://sofiaprefirma.com/api/ventas", { method: "POST", headers: { "x-forwarded-for": "1.1.1.1" },
    body: JSON.stringify({ accion: "pagar", nombre: "Lucía", notaria: "N12", telefono: "0991234567", plan: "PreFirma", periodo: "mensual", documento: "1716163660", aceptaTerminos: true, aceptaDatos: true }) }));
  expect((await almacen.consentimientos()).map((c) => c.canal)).toContain("pago-plan");
});
