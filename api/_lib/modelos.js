// Qué modelo de Claude atiende cada turno. Las consultas comunes van al modelo rápido (más barato); los casos complejos,
// con documentos o con molestia del cliente, al avanzado. La decisión mira toda la sesión, así que una conversación que
// ya escaló sigue en el avanzado: cambiar de modelo a cada turno perdería el caché, que es por modelo.
import { registrar } from "./metricas.js";

export const MODELO_AVANZADO = process.env.CLAUDE_MODEL || "claude-opus-5-5";
export const MODELO_RAPIDO = process.env.CLAUDE_MODEL_RAPIDO || "claude-sonnet-5-5";

// Trámites que suelen requerir criterio (varias partes, bienes o capital) y señales de reclamo o de pedir una persona.
export const COMPLEJO_NOTARIA = /herenc|herede|posesi[oó]n efectiva|testament|sucesi[oó]n|partici[oó]n|sociedad|compa[ñn][ií]a|constituci[oó]n de|aumento de capital|fideicomiso|divorci|disoluci[oó]n|liquidaci[oó]n|capitulaci|uni[oó]n de hecho|adopci|prescripci|rectificaci|revocatori|abogad|demanda|juicio|queja|reclamo|denuncia|no me entiendes|no entiendes|una persona|un humano/i;
export const COMPLEJO_VENTAS = /contrato|integraci|\bapi\b|seguridad|protecci[oó]n de datos|lopdp|factura|reclamo|queja|problema|error|no funciona|ca[ií]d[oa]|cancelar|reembolso/i;
const LARGO = 700;

// Textos que escribió el cliente en la sesión (los resultados de herramientas y los mensajes del sistema no cuentan).
export function textosDeCliente(mensajes = []) {
  return mensajes.filter((m) => m.role === "user").flatMap((m) =>
    typeof m.content === "string" ? [m.content] : (m.content || []).filter((b) => b.type === "text").map((b) => b.text));
}

export function elegirModelo({ textos = [], conDocumentos = false, patron = COMPLEJO_NOTARIA }) {
  if (conDocumentos) return { modelo: MODELO_AVANZADO, avanzado: true, motivo: "documentos" };
  for (const t of textos) {
    if (String(t).length > LARGO) return { modelo: MODELO_AVANZADO, avanzado: true, motivo: "mensaje largo" };
    if (patron.test(t)) return { modelo: MODELO_AVANZADO, avanzado: true, motivo: "caso complejo" };
  }
  return { modelo: MODELO_RAPIDO, avanzado: false, motivo: "consulta común" };
}

// Tokens por modelo: el avanzado conserva las claves de siempre; el rápido usa «ia.rapido.*» para costearlo a su precio.
export async function registrarUso(almacen, usage = {}, avanzado, t) {
  const prefijo = avanzado ? "ia." : "ia.rapido.";
  await registrar(almacen, prefijo + "llamadas", 1, t);
  for (const [campo, clave] of Object.entries({ input_tokens: "entrada", output_tokens: "salida", cache_read_input_tokens: "cache_lectura", cache_creation_input_tokens: "cache_escritura" }))
    await registrar(almacen, prefijo + "tokens_" + clave, usage?.[campo] || 0, t);
}
