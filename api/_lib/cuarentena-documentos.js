// Estado de seguridad del archivo, separado de la revisión notarial (recibido/aprobado/observado).
// Hasta que un analizador confiable marque el archivo como limpio, nadie puede verlo ni obtener una URL firmada.
export const ESTADOS_SEGURIDAD_DOCUMENTO = Object.freeze(["cuarentena", "limpio", "bloqueado", "error"]);
export const RESULTADOS_ANALISIS_DOCUMENTO = Object.freeze(["limpio", "infectado", "error", "timeout"]);

export const estadoSeguridadDocumento = (documento) =>
  ESTADOS_SEGURIDAD_DOCUMENTO.includes(documento?.seguridadEstado) ? documento.seguridadEstado : "cuarentena";

export const documentoVisible = (documento) => estadoSeguridadDocumento(documento) === "limpio";

export function resultadoAnalisisDocumento(resultado) {
  if (!RESULTADOS_ANALISIS_DOCUMENTO.includes(resultado)) throw new Error("Resultado de análisis de documento inválido");
  if (resultado === "limpio") return { estado: "limpio", motivo: "" };
  if (resultado === "infectado") return { estado: "bloqueado", motivo: "infectado" };
  return { estado: "error", motivo: resultado };
}
