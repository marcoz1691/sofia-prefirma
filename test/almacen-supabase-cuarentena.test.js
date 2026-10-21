import { describe, expect, it } from "vitest";
import { crearAlmacenSupabase } from "../api/_lib/almacen-supabase.js";

function clienteFalso({ filas = [], falloInsert = null } = {}) {
  const llamadas = [], subidas = [], removidos = [], descargas = [], firmas = [];
  const storage = {
    from: () => ({
      upload: async (ruta, bytes, opciones) => { subidas.push({ ruta, bytes, opciones }); return { data: null, error: null }; },
      remove: async (rutas) => { removidos.push(rutas); return { data: null, error: null }; },
      download: async (ruta) => { descargas.push(ruta); return { data: new Blob(["%PDF-limpio"]), error: null }; },
      createSignedUrl: async (ruta, segundos, opciones) => { firmas.push({ ruta, segundos, opciones }); return { data: { signedUrl: `https://privado.test/${ruta}` }, signedUrl: `https://privado.test/${ruta}`, error: null }; }
    })
  };
  const from = (tabla) => {
    const q = { tabla, ops: [] };
    const encadenar = (nombre) => (...args) => { q.ops.push([nombre, ...args]); return q; };
    for (const metodo of ["select", "eq", "is", "insert", "update"])
      q[metodo] = encadenar(metodo);
    const terminar = () => {
      llamadas.push({ tabla, ops: q.ops });
      if (tabla === "documentos" && q.ops.some(([op]) => op === "insert") && falloInsert) return Promise.resolve({ data: null, error: falloInsert });
      if (tabla === "documentos" && q.ops.some(([op]) => op === "insert")) return Promise.resolve({ data: { id: "d-1" }, error: null });
      if (tabla === "documentos" && q.ops.some(([op]) => op === "update")) {
        const seguridad = q.ops.find(([op, campo]) => op === "eq" && campo === "seguridad_estado")?.[2];
        const exigeNoBorrado = q.ops.some(([op, campo, valor]) => op === "is" && campo === "borrado_en" && valor === null);
        return Promise.resolve({ data: filas.filter((f) => (!seguridad || f.seguridad_estado === seguridad)
          && (!exigeNoBorrado || !f.borrado_en)).map((f) => ({ id: f.id })), error: null });
      }
      if (tabla === "documentos") return Promise.resolve({ data: filas[0] || null, error: null });
      return Promise.resolve({ data: [], error: null });
    };
    q.single = terminar;
    q.maybeSingle = terminar;
    q.then = (resolver, rechazar) => terminar().then(resolver, rechazar);
    return q;
  };
  return { cliente: { from, storage }, llamadas, subidas, removidos, descargas, firmas };
}

const documento = {
  id: "d-1", conversacion_id: "c-1", media_id: "m-1", nombre: "cedula.pdf", mime: "application/pdf",
  descripcion: "Cédula", tramite_id: "poder", estado: "recibido", nota: "", observacion_cliente: "",
  solicitud_id: null, creado: "2026-10-20T00:00:00.000Z", ruta: "notaria41/c-1/cuarentena/d-1-cedula.pdf",
  seguridad_estado: "cuarentena", seguridad_motivo: "", seguridad_revisado_en: null
};

describe("cuarentena documental en Supabase", () => {
  it("sube bajo cuarentena y no firma antes de un resultado limpio", async () => {
    const f = clienteFalso({ filas: [documento] }), a = crearAlmacenSupabase({ cliente: f.cliente });
    const { id } = await a.guardarDocumento({ conversacionId: "c-1", mediaId: "m-1", nombre: "cedula.pdf", mime: "application/pdf", bytes: new Uint8Array([1]), descripcion: "Cédula" });
    expect(id).toBe("d-1");
    expect(f.subidas[0].ruta).toContain("/cuarentena/");
    expect(await a.urlDocumento("d-1")).toBeNull();
  });

  it.each([
    ["limpio", "", `https://privado.test/${documento.ruta}`],
    ["infectado", "infectado", null],
    ["error", "error", null],
    ["timeout", "timeout", null]
  ])("registra resultado %s y solo publica el archivo limpio", async (resultado, motivo, url) => {
    const fila = { ...documento }, f = clienteFalso({ filas: [fila] }), a = crearAlmacenSupabase({ cliente: f.cliente });
    expect(await a.registrarAnalisisDocumento("d-1", resultado, { ahora: Date.parse("2026-10-20T01:02:03Z") })).toBe(true);
    const estado = resultado === "infectado" ? "bloqueado" : ["error", "timeout"].includes(resultado) ? "error" : resultado;
    expect(f.llamadas.at(-1).ops.find(([op]) => op === "update")[1]).toMatchObject({ seguridad_estado: estado, seguridad_motivo: motivo });
    fila.seguridad_estado = estado;
    fila.seguridad_motivo = motivo;
    expect(await a.urlDocumento("d-1")).toBe(url);
    expect(f.firmas).toHaveLength(resultado === "limpio" ? 1 : 0);
    if (resultado === "limpio") expect(f.firmas[0]).toMatchObject({ segundos: 120, opciones: { download: true } });
  });

  it("acota análisis y URL firmada al tenant fijo", async () => {
    const f = clienteFalso({ filas: [documento] }), a = crearAlmacenSupabase({ cliente: f.cliente, notariaId: "notaria-sur" });
    await a.documentoParaAnalisis("d-1");
    await a.registrarAnalisisDocumento("d-1", "error");
    await a.urlDocumento("d-1");
    const consultas = f.llamadas.filter((x) => x.tabla === "documentos");
    expect(consultas).toHaveLength(3);
    for (const q of consultas) expect(q.ops).toContainEqual(["eq", "notaria_id", "notaria-sur"]);
  });

  it("permite al analizador leer bytes sin crear URL y limpia un objeto si falla la fila", async () => {
    const f = clienteFalso({ filas: [documento] }), a = crearAlmacenSupabase({ cliente: f.cliente });
    const d = await a.documentoParaAnalisis("d-1");
    expect(d).toMatchObject({ id: "d-1", seguridadEstado: "cuarentena" });
    expect(Buffer.from(d.bytes).toString()).toBe("%PDF-limpio");
    expect(f.descargas).toEqual([documento.ruta]);

    const fallo = clienteFalso({ falloInsert: { message: "base caída", code: "XX" } }), b = crearAlmacenSupabase({ cliente: fallo.cliente });
    await expect(b.guardarDocumento({ conversacionId: "c-1", mediaId: "m-1", nombre: "x.pdf", bytes: new Uint8Array([1]) })).rejects.toThrow("base caída");
    expect(fallo.removidos).toHaveLength(1);
  });

  it("impide actualizar la revisión notarial mientras el archivo no esté limpio", async () => {
    const fila = { ...documento }, f = clienteFalso({ filas: [fila] }), a = crearAlmacenSupabase({ cliente: f.cliente });
    expect(await a.revisarDocumento("d-1", { estado: "aprobado", nota: "no guardar" })).toBe(false);
    const bloqueada = f.llamadas.at(-1).ops;
    expect(bloqueada).toContainEqual(["eq", "notaria_id", "notaria41"]);
    expect(bloqueada).toContainEqual(["eq", "seguridad_estado", "limpio"]);
    expect(bloqueada).toContainEqual(["is", "borrado_en", null]);

    fila.seguridad_estado = "limpio";
    expect(await a.revisarDocumento("d-1", { estado: "aprobado", nota: "revisión interna" })).toBe(true);
  });
});
