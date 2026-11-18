import { it, expect, vi } from "vitest";
import { armarDominio, esDominioNotarial } from "../js/dominio-notarial.js";
import { consultarDominio } from "../api/_lib/disponibilidad-dominio.js";
import { crearManejadorVentas } from "../api/_lib/ventas-http.js";
import { crearAlmacenMemoria } from "../api/_lib/almacen-memoria.js";
import { sistemaVentas, PLANES_CORREO } from "../api/_lib/catalogo-ventas.js";

const pedir = (m, cuerpo, ip = "190.2.2.2") => m.POST(new Request("https://sofiaprefirma.com/api/ventas", {
  method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(cuerpo) }));

it("arma el dominio notaria(número)(cantón).com: junto, sin tildes, eñes ni ceros a la izquierda", () => {
  expect(armarDominio("41", "Quito")).toBe("notaria41quito.com");
  expect(armarDominio("007", "Santo Domingo")).toBe("notaria7santodomingo.com");
  expect(armarDominio(3, "Rumiñahui")).toBe("notaria3ruminahui.com");
  expect(armarDominio("12", "Cañar")).toBe("notaria12canar.com");
  expect(armarDominio("", "Quito")).toBeNull();
  expect(armarDominio("0", "Quito")).toBeNull();
  expect(armarDominio("1000", "Quito")).toBeNull();
  expect(armarDominio("5", "<b>")).toBeNull();
  expect(esDominioNotarial("notaria41quito.com")).toBe(true);
  expect(esDominioNotarial("notaria41quito.com.ec")).toBe(false);
  expect(esDominioNotarial("evil.com")).toBe(false);
});

it("consulta el registro .com: 404 libre, 200 ocupado y cualquier falla desconocido", async () => {
  const con = (status) => vi.fn(async () => new Response("{}", { status }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await consultarDominio("notaria1quito.com", { fetch: con(404) })).toBe("libre");
  expect(await consultarDominio("notaria1quito.com", { fetch: con(200) })).toBe("ocupado");
  expect(await consultarDominio("notaria1quito.com", { fetch: con(503) })).toBe("desconocido");
  expect(await consultarDominio("notaria1quito.com", { fetch: async () => { throw new Error("sin red"); } })).toBe("desconocido");
  const f = con(404);
  await consultarDominio("notaria9loja.com", { fetch: f });
  expect(f.mock.calls[0][0]).toBe("https://rdap.verisign.com/com/v1/domain/notaria9loja.com");
});

it("la API de ventas responde si el dominio está libre y limita las consultas por conexión", async () => {
  const consultar = vi.fn(async () => "libre");
  const m = crearManejadorVentas({ agente: {}, almacen: crearAlmacenMemoria(), ahora: () => 1_000_000, consultarDominio: consultar });
  const r = await pedir(m, { accion: "dominio", numero: "12", canton: "Cuenca" });
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ dominio: "notaria12cuenca.com", correo: "nombre.apellido@notaria12cuenca.com", estado: "libre" });
  expect(consultar).toHaveBeenCalledWith("notaria12cuenca.com");
  expect((await pedir(m, { accion: "dominio", numero: "", canton: "Cuenca" })).status).toBe(400);
  for (let i = 0; i < 30; i++) await pedir(m, { accion: "dominio", numero: "1", canton: "Loja" }, "190.3.3.3");
  expect((await pedir(m, { accion: "dominio", numero: "1", canton: "Loja" }, "190.3.3.3")).status).toBe(429);
});

it("el pedido de correo se registra con el dominio y avisa al asesor", async () => {
  const almacen = crearAlmacenMemoria(), avisar = vi.fn(async () => {});
  const m = crearManejadorVentas({ agente: {}, almacen, avisar, ahora: () => 1_000_000 });
  const r = await pedir(m, { accion: "solicitar", plan: "Correo del Notario", periodo: "anual", nombre: "Ana Ruiz", notaria: "Notaría 12 de Cuenca",
    telefono: "0987654321", dominio: "notaria12cuenca.com", aceptaTerminos: true, aceptaDatos: true });
  expect(r.status).toBe(200);
  expect((await almacen.prospectos())[0]).toMatchObject({ plan: "Correo del Notario", detalle: "Correo · notaria12cuenca.com · pago anual" });
  expect(avisar.mock.calls[0][0]).toContain("notaria12cuenca.com");
  await pedir(m, { accion: "solicitar", plan: "Correo Notaría completa", nombre: "Ana Ruiz", notaria: "Notaría 12 de Cuenca",
    telefono: "0987654321", dominio: "<script>.com", aceptaTerminos: true, aceptaDatos: true }, "190.4.4.4");
  expect((await almacen.prospectos()).find((p) => p.plan === "Correo Notaría completa").detalle).toBe("Correo · dominio por definir · pago mensual");
});

it("Sofía conoce los planes de correo y no menciona al Consejo de la Judicatura", () => {
  expect(PLANES_CORREO.map((p) => [p.nombre, p.instalacion, p.mensual])).toEqual([["Correo del Notario", 25, 12], ["Correo Notaría completa", 25, 29]]);
  const s = sistemaVentas();
  expect(s).toContain("Correo del Notario (El correo del notario, con el nombre de su notaría): instalación USD 25 (pago único, gratis con pago anual) y USD 12 al mes, o USD 120 al año");
  expect(s).toContain("No menciones al Consejo de la Judicatura");
  expect(s).not.toContain("CJ-DNDMCSJ");
  expect(s).toContain("Con el plan PreFirma o superior de Sofía, el plan Correo del Notario va incluido");
});

it("la página de correo tiene los mismos precios que el catálogo de Sofía", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../correo-notarial.html", import.meta.url), "utf8");
  for (const p of PLANES_CORREO) {
    const tarjeta = html.split(`data-plan="${p.nombre}"`)[1].split("</article>")[0];
    expect(tarjeta).toContain(`<strong>${p.mensual}</strong>`);
    expect(tarjeta).toContain(`o USD ${p.mensual * 10} al año · instalación USD ${p.instalacion}`);
    for (const linea of p.incluye) expect(tarjeta).toContain(`<li>${linea}</li>`);
  }
});

it("el sitio comercial sirve la página de correo y la incluye en el sitemap", async () => {
  const { default: middleware } = await import("../middleware.js");
  const pagina = await middleware(new Request("https://sofiaprefirma.com/correo-notarial"));
  expect(pagina.headers.get("x-middleware-rewrite")).toBe("https://sofiaprefirma.com/correo-notarial.html");
  for (const r of ["/correo-notarial.html", "/js/correo-notarial.js", "/js/dominio-notarial.js", "/css/correo-notarial.css"])
    expect((await middleware(new Request("https://sofiaprefirma.com" + r))).status).not.toBe(404);
  expect(await (await middleware(new Request("https://sofiaprefirma.com/sitemap.xml"))).text()).toContain("<loc>https://sofiaprefirma.com/correo-notarial</loc>");
});

it("los textos legales de SOFIA PreFirma cubren el servicio de correo y usan el correo de ventas", async () => {
  const { readFileSync } = await import("node:fs");
  const { TERMINOS_PREFIRMA, AVISO_PRIVACIDAD_PREFIRMA } = await import("../js/legal.js");
  const terminos = readFileSync(new URL("../prefirma-terminos.html", import.meta.url), "utf8");
  const privacidad = readFileSync(new URL("../prefirma-privacidad.html", import.meta.url), "utf8");
  expect(terminos).toContain(`Versión ${TERMINOS_PREFIRMA}`);
  expect(privacidad).toContain(`Versión ${AVISO_PRIVACIDAD_PREFIRMA}`);
  expect(terminos).toContain("Servicio de dominio y correo para notarías");
  expect(terminos).not.toContain("Consejo");
  expect(terminos).toContain("no se cobra con pago anual");
  expect(privacidad).toContain("datos del titular del dominio");
  for (const t of [terminos, privacidad]) {
    expect(t).toContain("ventas@sofiaprefirma.com");
    expect(t).not.toContain("@gmail.com");
  }
});
