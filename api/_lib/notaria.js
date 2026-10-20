// Notaría que atiende cada pedido. Nunca se toma del cuerpo ni de un parámetro del navegador: la decide el servidor
// por el dominio (docs/multi-notaria.md). NOTARIA_ID permite que cada proyecto de Vercel quede fijado a su notaría.
export const NOTARIA_POR_DEFECTO = "notaria41";

const idValido = (id) => typeof id === "string" && /^[a-z0-9-]{3,40}$/.test(id);
const hostDe = (request) => {
  try { return new URL(request.url).hostname.toLowerCase(); }
  catch { return ""; }
};

export function notariaDe(request, env = process.env) {
  if (env.NOTARIA_ID !== undefined && !idValido(env.NOTARIA_ID)) throw new Error("NOTARIA_ID no es válida");
  if (idValido(env.NOTARIA_ID)) return env.NOTARIA_ID;
  const host = hostDe(request);
  // En la plataforma, cada subdominio de notaría resuelve a su identificador. Los subdominios reservados siguen
  // usando el piloto hasta que exista la selección pública de notaría.
  const sufijo = ".sofiaprefirma.com";
  if (host.endsWith(sufijo)) {
    const subdominio = host.slice(0, -sufijo.length);
    if (!subdominio.includes(".") && !["www", "app", "portal"].includes(subdominio) && idValido(subdominio)) return subdominio;
  }
  // El valor por defecto facilita pruebas y desarrollo local. En producción, un host reservado, una preview o un
  // dominio desconocido nunca debe caer silenciosamente en los datos del piloto.
  if (env.VERCEL_ENV === "production") throw new Error("No se pudo determinar la notaría para este host");
  return NOTARIA_POR_DEFECTO;
}

// Todo método del almacén del portal exige la notaría: sin ella no hay consulta posible (aislamiento entre notarías).
export function exigirNotaria(notariaId) {
  if (typeof notariaId !== "string" || !/^[a-z0-9-]{3,40}$/.test(notariaId)) throw new Error("Falta la notaría o no es válida");
  return notariaId;
}
