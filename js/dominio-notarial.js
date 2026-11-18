// Dominio que pide el Consejo de la Judicatura (oficio CJ-DNDMCSJ-2026-1194-OF, 17 de noviembre de 2026):
// nombre.apellido@notaria(Nro.notaria)(cantón).com. Lo usan la página correo-notarial.html y api/_lib/ventas-http.js.
// El cantón va sin espacios, tildes ni eñes y el número sin ceros a la izquierda; antes de comprarlo se confirma con la notaría.

export function armarDominio(numero, canton) {
  const n = Number.parseInt(String(numero ?? "").replace(/\D/g, ""), 10);
  const c = String(canton ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!Number.isInteger(n) || n < 1 || n > 999 || c.length < 2 || c.length > 40) return null;
  return `notaria${n}${c}.com`;
}

export const esDominioNotarial = (d) => /^notaria[1-9]\d{0,2}[a-z0-9]{2,40}\.com$/.test(String(d ?? ""));
