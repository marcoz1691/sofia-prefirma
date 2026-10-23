import { rewrite, next } from "@vercel/functions";
export const ID_PROYECTO_COMERCIAL = "prj_MJWXidhzCEkrzFMOdKi61GSfSjPj";
export const config = { matcher: ["/", "/index.html", "/cita.html", "/asistente.html", "/privacidad.html", "/404.html", "/api/:path*"] };

export function esVitrinaComercial(url, env = process.env) {
  const host = new URL(url).hostname.toLowerCase();
  return env.SOFIA_MODO === "comercial"
    || env.VERCEL_PROJECT_ID === ID_PROYECTO_COMERCIAL
    || ["sofiaprefirma.com", "www.sofiaprefirma.com", "sofia-prefirma.vercel.app", "sofiaprefirma-marcspro.vercel.app"].includes(host);
}

export function decidir(url, funciones) {
  const u = new URL(url);
  return config.matcher.includes(u.pathname) && funciones?.sitio === false ? new URL("/mantenimiento.html", u).href : null;
}
export default async function middleware(request) {
  const ruta = new URL(request.url).pathname;
  if (ruta.startsWith("/api/")) {
    if (esVitrinaComercial(request.url)) {
      return Response.json({ error: "Esta ruta no está disponible en el sitio comercial." }, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return next();
  }
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
