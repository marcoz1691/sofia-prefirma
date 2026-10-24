export const canalDeTelefono = (tel) => String(tel).startsWith("web:") ? "web" : String(tel).startsWith("form:") ? "formulario" : "whatsapp";
export async function registrar(almacen, clave, valor = 1, t = Date.now()) {
  try {
    if (!valor) return;
    const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
    await almacen.sumarMetrica(fecha, clave, valor);
  } catch (e) { console.error("Métrica no registrada:", clave, e); }
}
export const CLAVES = [
  ...["conv.nueva", "msg.cliente", "conv.derivada", "cita.creada", "doc.recibido"].flatMap((k) => ["whatsapp", "web", "formulario"].map((c) => k + "." + c)),
  "ia.llamadas", "ia.tokens_entrada", "ia.tokens_salida", "ia.tokens_cache_lectura", "ia.tokens_cache_escritura",
  "ia.rapido.llamadas", "ia.rapido.tokens_entrada", "ia.rapido.tokens_salida", "ia.rapido.tokens_cache_lectura", "ia.rapido.tokens_cache_escritura",
  "cita.atendida", "cita.cancelada", "cita.inasistencia", "recordatorio.enviado", "respuesta.automatica"
];
// USD por millón de tokens: modelo avanzado (Claude Opus 5.5) y modelo rápido (Claude Sonnet 5.5).
export const PRECIOS = { entrada: 4, salida: 20, cacheLectura: 0.2, cacheEscritura: 5,
  rapidoEntrada: 2, rapidoSalida: 10, rapidoCacheLectura: 0.2, rapidoCacheEscritura: 2.5, plantillaWhatsapp: 0 };
// Costo de IA en USD para un conjunto de métricas (totales o un día).
export function costoIa(v, p) {
  const n = (k) => Number(v["ia." + k] || 0), r = (k) => Number(v["ia.rapido." + k] || 0);
  return (n("tokens_entrada") * p.entrada + n("tokens_salida") * p.salida + n("tokens_cache_lectura") * p.cacheLectura + n("tokens_cache_escritura") * p.cacheEscritura
    + r("tokens_entrada") * p.rapidoEntrada + r("tokens_salida") * p.rapidoSalida + r("tokens_cache_lectura") * p.rapidoCacheLectura + r("tokens_cache_escritura") * p.rapidoCacheEscritura) / 1e6;
}
