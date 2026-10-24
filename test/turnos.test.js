import { describe, it, expect, vi } from "vitest";
import { crearManejadorTurnos, llamarSiguiente, marcarTurno, filaDelDia, etiqueta } from "../api/_lib/turnos.js";
import { crearAlmacenMemoria } from "../api/_lib/almacen-memoria.js";

const AHORA = Date.parse("2026-10-23T15:00:00Z");
const pedir = (cuerpo, ip = "190.1.1.1") => new Request("https://notaria41.vercel.app/api/turnos", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
  body: JSON.stringify({ accion: "tomar", aceptaTerminos: true, aceptaDatos: true, ...cuerpo }) });
const ver = (q) => new Request("https://notaria41.vercel.app/api/turnos?" + q);

async function preparar() {
  const almacen = crearAlmacenMemoria();
  await almacen.guardarAjuste("funcion.turnero", "1", "admin");
  return { almacen, m: crearManejadorTurnos({ almacen, ahora: () => AHORA }) };
}

describe("turnero", () => {
  it("numera los turnos del día y dice cuántas personas hay delante", async () => {
    const { m } = await preparar();
    const a = await (await m.POST(pedir({ nombre: "Ana Pérez" }))).json();
    const b = await (await m.POST(pedir({ nombre: "Luis Mora", celular: "0991234567" }, "190.1.1.2"))).json();
    expect(a).toMatchObject({ numero: "T-001", estado: "esperando", delante: 0 });
    expect(b).toMatchObject({ numero: "T-002", delante: 1 });
    expect(b.codigo).toMatch(/^[0-9a-f]{24}$/);
    expect(await (await m.GET(ver("accion=estado&codigo=" + b.codigo))).json()).toMatchObject({ numero: "T-002", delante: 1 });
  });

  it("pide nombre, casillas y un celular válido si lo escriben", async () => {
    const { m } = await preparar();
    expect((await m.POST(pedir({ nombre: "A" }))).status).toBe(400);
    expect((await m.POST(pedir({ nombre: "Ana", aceptaDatos: false }))).status).toBe(400);
    expect((await m.POST(pedir({ nombre: "Ana", celular: "123" }))).status).toBe(400);
  });

  it("llama al siguiente, avisa por WhatsApp y nunca llama dos veces al mismo", async () => {
    const { almacen, m } = await preparar();
    await m.POST(pedir({ nombre: "Ana Pérez" }));
    const b = await (await m.POST(pedir({ nombre: "Luis Mora", celular: "0991234567" }, "190.1.1.2"))).json();
    const whatsapp = { enviarPlantilla: vi.fn(async () => {}) };
    const [uno, dos] = await Promise.all([llamarSiguiente(almacen, { ventanilla: "1", whatsapp, ahora: AHORA }), llamarSiguiente(almacen, { ventanilla: "2", whatsapp, ahora: AHORA })]);
    expect([uno.llamado.numero, dos.llamado.numero].sort()).toEqual(["T-001", "T-002"]);
    expect(whatsapp.enviarPlantilla).toHaveBeenCalledTimes(1);
    expect(whatsapp.enviarPlantilla).toHaveBeenCalledWith("593991234567", "turno_llamado", ["T-002", expect.any(String)]);
    expect(await (await m.GET(ver("accion=estado&codigo=" + b.codigo))).json()).toMatchObject({ estado: "llamado" });
    expect((await llamarSiguiente(almacen, { ventanilla: "1", ahora: AHORA })).llamado).toBe(null);
  });

  it("la sala muestra números y ventanillas, nunca nombres", async () => {
    const { almacen, m } = await preparar();
    await m.POST(pedir({ nombre: "Ana Pérez" }));
    await llamarSiguiente(almacen, { ventanilla: "3", ahora: AHORA });
    const texto = await (await m.GET(ver("accion=sala"))).text();
    expect(JSON.parse(texto)).toMatchObject({ llamados: [{ numero: "T-001", ventanilla: "3", actual: true }], esperando: 0 });
    expect(texto).not.toContain("Ana");
  });

  it("el personal marca atendido o ausente solo turnos de hoy", async () => {
    const { almacen, m } = await preparar();
    await m.POST(pedir({ nombre: "Ana Pérez" }));
    const { llamado } = await llamarSiguiente(almacen, { ventanilla: "1", ahora: AHORA });
    const id = (await filaDelDia(almacen, AHORA)).turnos[0].id;
    expect((await marcarTurno(almacen, { id, estado: "atendido" }, AHORA)).turnos[0].estado).toBe("atendido");
    await expect(marcarTurno(almacen, { id, estado: "borrado" }, AHORA)).rejects.toThrow();
    await expect(marcarTurno(almacen, { id, estado: "ausente" }, AHORA + 86400000)).rejects.toThrow("no es de hoy");
    expect(llamado.numero).toBe(etiqueta(1));
  });

  it("viene apagado hasta que se enciende en Funciones", async () => {
    const m = crearManejadorTurnos({ almacen: crearAlmacenMemoria(), ahora: () => AHORA });
    const r = await m.POST(pedir({ nombre: "Ana" }));
    expect(r.status).toBe(503);
    expect((await r.json()).error).toContain("Acércate a recepción");
  });
});
