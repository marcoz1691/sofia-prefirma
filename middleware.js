import { rewrite, next } from "@vercel/functions";
export const ID_PROYECTO_COMERCIAL = "prj_MJWXidhzCEkrzFMOdKi61GSfSjPj";
const RUTAS_CON_INTERRUPTOR = new Set(["/", "/index.html", "/cita.html", "/asistente.html", "/privacidad.html", "/404.html", "/turno.html", "/sala.html"]);
const RECURSOS_COMERCIALES = new Set([
  "/propuesta-sofia.html",
  "/css/propuesta-sofia.css",
  "/js/propuesta-sofia.js",
  "/js/movimiento.js",
  "/assets/logo/sofia-prefirma-oficial.svg",
  "/assets/logo/sofia-prefirma-oficial-blanco.svg",
  "/assets/logo/sofia-prefirma-oficial-simbolo.svg",
  "/js/ventas-chat.js",
  "/js/chat-nucleo.js",
  "/js/aceptacion.js",
  "/js/legal.js",
  "/prefirma-privacidad.html",
  "/prefirma-terminos.html",
  "/robots.txt",
]);
export const config = { matcher: ["/:path*"] };

export function esVitrinaComercial(url, env = process.env) {
  const host = new URL(url).hostname.toLowerCase();
  return env.SOFIA_MODO === "comercial"
    || env.VERCEL_PROJECT_ID === ID_PROYECTO_COMERCIAL
    || ["sofiaprefirma.com", "www.sofiaprefirma.com", "sofia-prefirma.vercel.app", "sofiaprefirma-marcspro.vercel.app"].includes(host);
}

export function decidir(url, funciones) {
  const u = new URL(url);
  return RUTAS_CON_INTERRUPTOR.has(u.pathname) && funciones?.sitio === false ? new URL("/mantenimiento.html", u).href : null;
}
export default async function middleware(request) {
  const ruta = new URL(request.url).pathname;
  if (esVitrinaComercial(request.url)) {
    // La única API del sitio comercial es el chat de ventas, que trabaja en su propio tenant (api/ventas.js).
    if (ruta === "/api/ventas") return next();
    if (ruta === "/api" || ruta.startsWith("/api/")) {
      return Response.json({ error: "Esta ruta no está disponible en el sitio comercial." }, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (ruta === "/" || ruta === "/propuesta") return rewrite(new URL("/propuesta-sofia.html", request.url));
    if (RECURSOS_COMERCIALES.has(ruta) || ruta.startsWith("/assets/fonts/")) return next();
    return new Response("Página no encontrada.", {
      status: 404,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (ruta === "/api" || ruta.startsWith("/api/") || !RUTAS_CON_INTERRUPTOR.has(ruta)) return next();
  try {
    const r = await fetch(new URL("/api/precios", request.url), { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return next();
    // En previews protegidos Vercel puede responder aquí con la página HTML de autenticación.
    // No intentes interpretarla como JSON ni llenes los logs con un error esperado: el sitio sigue
    // cerrado por Deployment Protection y el interruptor se comprobará al consultar la API autenticada.
    if (!r.headers.get("content-type")?.toLowerCase().includes("application/json")) return next();
    const destino = decidir(request.url, (await r.json()).funciones);
    if (destino) return rewrite(destino, { status: 503, headers: { "Cache-Control": "no-store" } });
  } catch (e) { console.error("No se pudo leer el estado del sitio:", e); }
  return next();
}
