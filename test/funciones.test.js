import { it, expect } from "vitest";
import { leerFunciones, funcionWebActiva, leerAjustes } from "../api/_lib/funciones.js";
import { decidir, esVitrinaComercial, ID_PROYECTO_COMERCIAL } from "../middleware.js";
it("conserva valores independientes y aplica la dependencia solo en la web", () => {
  const f = leerFunciones({ "funcion.sitio": "0", "funcion.agenda": "1" });
  expect(f.agenda).toBe(true); expect(funcionWebActiva(f, "agenda")).toBe(false);
  const porDefecto = leerFunciones();
  expect(Object.entries(porDefecto).filter(([, v]) => !v).map(([k]) => k)).toEqual(["portal", "turnero", "pagosEnLinea"]);
  expect(decidir("https://ejemplo.test/cita.html", f)).toBe("https://ejemplo.test/mantenimiento.html");
  expect(decidir("https://ejemplo.test/panel/", f)).toBeNull();
});
it("falla abierto al leer ajustes", async () => {
  expect(await leerAjustes({ ajustes: async () => { throw Error("lectura"); } })).toEqual({});
});
it("reescribe con 503 y falla abierto ante errores", async () => {
 const { default: middleware } = await import("../middleware.js");
 const original = globalThis.fetch;
 try {
 globalThis.fetch = async () => Response.json({ funciones: { sitio: false } });
 const r = await middleware(new Request("https://ejemplo.test/"));
 expect(r.status).toBe(503); expect(r.headers.get("x-middleware-rewrite")).toBe("https://ejemplo.test/mantenimiento.html");
 expect(r.headers.get("Cache-Control")).toBe("no-store");
 globalThis.fetch = async () => new Response("<!doctype html><title>Vercel Authentication</title>", { headers: { "content-type": "text/html; charset=utf-8" } });
 expect((await middleware(new Request("https://ejemplo.test/"))).headers.get("x-middleware-next")).toBe("1");
 globalThis.fetch = async () => { throw Error("sin red"); };
 expect((await middleware(new Request("https://ejemplo.test/"))).headers.get("x-middleware-next")).toBe("1");
 } finally { globalThis.fetch = original; }
});

it("la vitrina comercial no expone las API de una notaría", async () => {
 const { default: middleware } = await import("../middleware.js");
 expect(esVitrinaComercial("https://sofiaprefirma.com/api/precios", {})).toBe(true);
 expect(esVitrinaComercial("https://preview.example/api/precios", { VERCEL_PROJECT_ID: ID_PROYECTO_COMERCIAL })).toBe(true);
 expect(esVitrinaComercial("https://notaria41.sofiaprefirma.com/api/precios", { NOTARIA_ID: "notaria41" })).toBe(false);
 const r = await middleware(new Request("https://sofiaprefirma.com/api/precios"));
 expect(r.status).toBe(404);
 expect(r.headers.get("Cache-Control")).toBe("no-store");
 expect(await r.json()).toEqual({ error: "Esta ruta no está disponible en el sitio comercial." });
 const piloto = await middleware(new Request("https://notaria41.sofiaprefirma.com/api/precios"));
 expect(piloto.headers.get("x-middleware-next")).toBe("1");
});

it("la vista previa comercial sirve solo la propuesta de Sofía", async () => {
 const { default: middleware } = await import("../middleware.js");
 const original = process.env.VERCEL_PROJECT_ID;
 process.env.VERCEL_PROJECT_ID = ID_PROYECTO_COMERCIAL;
 try {
   const propuesta = await middleware(new Request("https://preview.example/propuesta"));
   expect(propuesta.headers.get("x-middleware-rewrite")).toBe("https://preview.example/propuesta-sofia.html");
   const portada = await middleware(new Request("https://preview.example/"));
   expect(portada.headers.get("x-middleware-rewrite")).toBe("https://preview.example/propuesta-sofia.html");
   expect((await middleware(new Request("https://preview.example/assets/logo/sofia-prefirma-oficial.svg"))).headers.get("x-middleware-next")).toBe("1");
   expect((await middleware(new Request("https://preview.example/index.html"))).status).toBe(404);
   expect((await middleware(new Request("https://preview.example/panel/"))).status).toBe(404);
 } finally {
   if (original === undefined) delete process.env.VERCEL_PROJECT_ID;
   else process.env.VERCEL_PROJECT_ID = original;
 }
});

it("portal y pagos en línea se encienden solo con \"1\"; las demás se apagan solo con \"0\"", () => {
  expect(leerFunciones({ "funcion.portal": "1", "funcion.pagosEnLinea": "x" })).toMatchObject({ portal: true, pagosEnLinea: false, agenda: true });
  expect(leerFunciones({ "funcion.portal": "0", "funcion.agenda": "x" })).toMatchObject({ portal: false, agenda: true });
});
