import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { crearAlmacenSupabase } from "../api/_lib/almacen-supabase.js";

function clienteGrabador(datos = {}) {
  const llamadas = [];
  const from = (tabla) => {
    const q = { tabla, ops: [] };
    const encadenar = (nombre) => (...args) => { q.ops.push([nombre, ...args]); return q; };
    for (const metodo of ["select", "eq", "in", "is", "not", "gte", "lte", "lt", "order", "limit", "insert", "upsert", "update", "delete"])
      q[metodo] = encadenar(metodo);
    const terminar = () => {
      llamadas.push({ tabla, ops: q.ops });
      const valor = Object.hasOwn(datos, tabla) ? datos[tabla] : [];
      return Promise.resolve({ data: valor, error: null });
    };
    q.single = terminar;
    q.maybeSingle = terminar;
    q.then = (resolver, rechazar) => terminar().then(resolver, rechazar);
    return q;
  };
  return { cliente: { from, rpc: async () => ({ data: 1, error: null }) }, llamadas };
}

const tieneTenant = (llamada, id) => llamada.ops.some((op) => op[0] === "eq" && op[1] === "notaria_id" && op[2] === id);

describe("aislamiento del almacén Supabase", () => {
  it("acota las lecturas del núcleo a la notaría fija", async () => {
    const { cliente, llamadas } = clienteGrabador({
      mensajes: [{ contenido: { role: "user", content: "hola" } }],
      archivos: null
    });
    const id = "notaria-sur", a = crearAlmacenSupabase({ cliente, notariaId: id });
    await a.precios();
    await a.ajustes();
    await a.metricas("2026-01-01", "2026-01-31");
    await a.equipo();
    await a.conversaciones();
    await a.historial("conv-1");
    await a.documentos("conv-1");
    await a.solicitudesCita("conv-1");
    await a.agenda("2026-01-10");
    await a.auditoria();
    await a.archivoRecibido("conv-1", "media-1");

    expect(llamadas).not.toHaveLength(0);
    for (const llamada of llamadas) expect(tieneTenant(llamada, id), `${llamada.tabla} no quedó acotada`).toBe(true);
  });

  it("incluye la notaría en las nuevas filas hijas", async () => {
    const { cliente, llamadas } = clienteGrabador();
    const id = "notaria-sur", a = crearAlmacenSupabase({ cliente, notariaId: id });
    await a.encolar("conv-1", { texto: "hola" });
    await a.registrarArchivo("conv-1", { id: "media-1", mime: "application/pdf", nombre: "cedula.pdf" });
    await a.marcarProcesado("wamid-1");

    const datosDe = (tabla, operacion) => llamadas.find((x) => x.tabla === tabla)?.ops.find((op) => op[0] === operacion)?.[1];
    expect(datosDe("pendientes", "insert")).toMatchObject({ notaria_id: id, conversacion_id: "conv-1" });
    expect(datosDe("archivos", "upsert")).toMatchObject({ notaria_id: id, conversacion_id: "conv-1" });
    expect(datosDe("procesados", "insert")).toMatchObject({ notaria_id: id, wa_id: "wamid-1" });
  });

  it("rechaza usar el portal con una notaría distinta a la del despliegue", async () => {
    const { cliente, llamadas } = clienteGrabador({ clientes: null });
    const a = crearAlmacenSupabase({ cliente, notariaId: "notaria-sur" });
    await expect(a.clientePorEmail("notaria41", "ana@example.test")).rejects.toThrow(/no corresponde/);
    expect(llamadas).toHaveLength(0);
    await expect(a.clientePorEmail("notaria-sur", "ana@example.test")).resolves.toBeNull();
    expect(tieneTenant(llamadas[0], "notaria-sur")).toBe(true);
  });

  it("la migración añade tenant y llaves compuestas a las tablas hijas", async () => {
    const sql = await readFile(new URL("../supabase/esquema.sql", import.meta.url), "utf8");
    for (const tabla of ["sesiones", "mensajes", "pendientes", "archivos", "documentos"])
      expect(sql).toMatch(new RegExp(`alter table ${tabla} add column if not exists notaria_id`));
    expect(sql).toContain("foreign key (notaria_id, sesion_id) references sesiones(notaria_id, id)");
    expect(sql).toContain("primary key (notaria_id, conversacion_id, id)");
    expect(sql).toContain("drop constraint if exists sesiones_conversacion_id_fkey");
    expect(sql).toContain("drop constraint if exists solicitudes_cita_conversacion_id_fkey");
    expect(sql).toContain("select sumar_metrica('notaria41', p_fecha, p_clave, p_valor)");
    expect(sql).toContain("select incrementar_uso('notaria41', p_clave, p_ventana)");
    expect(sql).not.toMatch(/alter column notaria_id drop default/);
  });
});
