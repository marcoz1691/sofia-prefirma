// Contrato de la pasarela de pagos (Sofía PreFirma: el ciudadano paga su trámite y la notaría paga su plan). La pasarela real es
// PagoMedios (pagomedios.js); mientras no esté configurada, obtenerProveedorPagos devuelve null y el pago en línea no existe.
//
// Un proveedor es un objeto con:
//   nombre: texto corto y estable (se guarda en pagos.proveedor y pago_eventos.proveedor).
//   crearOrden({ pago, urlRetorno })            → { orden }        Registra la orden en la pasarela (pago.montoCentavos, pago.moneda).
//   iniciarCheckout({ pago, orden, urlRetorno }) → { urlCheckout }  Página de pago alojada por la pasarela: la tarjeta nunca pasa por aquí.
//   consultarPago({ orden })                     → { estado, monto, moneda }
//   procesarWebhook(request)                     → { valido, eventoId, orden, estado, monto, moneda, tipo, cargaHuella }
//       o, si el aviso del proveedor no trae firma propia, { valido, consultar: true, pagoId, tipo, cargaHuella }: el estado se
//       confirma entonces con consultarPago, nunca con el contenido del aviso.
//       Verifica la firma sobre el cuerpo crudo. `estado` es uno de ESTADOS; `monto` va en centavos (entero);
//       `cargaHuella` es el sha256 del cuerpo (el cuerpo nunca se guarda). Si la firma no es válida: { valido: false, cargaHuella }.
//   reembolsar?({ pago })                        → opcional.
// Nunca se reciben, guardan ni registran datos de tarjeta.
import { crearProveedorFalso } from "./proveedor-falso.js";
import { crearProveedorPagoMedios } from "./pagomedios.js";

export const ESTADOS = ["creado", "pendiente", "procesando", "pagado", "fallido", "cancelado", "reembolsado"];

// Transiciones permitidas. fallido, cancelado y reembolsado son terminales. No hay ciclos: un evento repetido nunca aplica dos veces.
export const TRANSICIONES = Object.freeze({
  creado: Object.freeze(["pendiente", "cancelado", "fallido"]),
  pendiente: Object.freeze(["procesando", "pagado", "fallido", "cancelado"]),
  procesando: Object.freeze(["pagado", "fallido", "cancelado"]),
  pagado: Object.freeze(["reembolsado"]),
  fallido: Object.freeze([]),
  cancelado: Object.freeze([]),
  reembolsado: Object.freeze([])
});

export const puedePasar = (de, a) => Object.hasOwn(TRANSICIONES, de) && TRANSICIONES[de].includes(a);
export const esTerminal = (estado) => Object.hasOwn(TRANSICIONES, estado) && TRANSICIONES[estado].length === 0;

const METODOS = ["crearOrden", "iniciarCheckout", "consultarPago", "procesarWebhook"];
export function validarProveedor(p) {
  if (!p || typeof p.nombre !== "string" || !/^[a-z0-9-]{2,40}$/.test(p.nombre)) throw new Error("Proveedor de pagos sin nombre válido");
  for (const m of METODOS) if (typeof p[m] !== "function") throw new Error(`Proveedor de pagos sin ${m}`);
  return p;
}

// Devuelve el proveedor configurado o null. PagoMedios usa PAGOMEDIOS_TOKEN (de pruebas o de producción, según el que entregue
// PagoMedios) y PAGOS_SECRETO para firmar sus enlaces de aviso. El falso solo existe fuera de producción.
export function obtenerProveedorPagos(env = process.env) {
  if (env.PAGOS_PROVEEDOR === "pagomedios" && env.PAGOMEDIOS_TOKEN && env.PAGOS_SECRETO)
    return validarProveedor(crearProveedorPagoMedios({ token: env.PAGOMEDIOS_TOKEN, secreto: env.PAGOS_SECRETO, base: env.PAGOMEDIOS_API || undefined }));
  if (env.PAGOS_PROVEEDOR === "falso" && env.VERCEL_ENV !== "production" && env.PAGOS_SECRETO_PRUEBA)
    return validarProveedor(crearProveedorFalso({ secreto: env.PAGOS_SECRETO_PRUEBA, entorno: env.VERCEL_ENV }));
  return null;
}
