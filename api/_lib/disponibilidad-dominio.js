// ¿Está libre un dominio .com? Pregunta al registro de Verisign por RDAP (público, sin clave):
// 200 = ya registrado, 404 = libre. Cualquier otra respuesta o un corte de red se informa como «desconocido».
const RDAP_COM = "https://rdap.verisign.com/com/v1/domain/";

export async function consultarDominio(dominio, { fetch: f = globalThis.fetch, timeoutMs = 4000 } = {}) {
  try {
    const r = await f(RDAP_COM + encodeURIComponent(dominio), {
      headers: { Accept: "application/rdap+json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 404) return "libre";
    if (r.ok) return "ocupado";
    console.warn(`RDAP respondió ${r.status} para ${dominio}`);
  } catch (e) {
    console.warn("No se pudo consultar RDAP:", e.message);
  }
  return "desconocido";
}
