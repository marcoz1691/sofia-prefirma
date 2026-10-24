// Chat de ventas y atención de SOFIA PreFirma: https://sofiaprefirma.com/api/ventas
// Solo responde en el sitio comercial y con su propio tenant, para no mezclar estas conversaciones con las de una notaría.
import Anthropic from "@anthropic-ai/sdk";
import { crearManejadorVentas } from "./_lib/ventas-http.js";
import { crearAgenteVentas } from "./_lib/ventas.js";
import { TENANT_VENTAS } from "./_lib/catalogo-ventas.js";
import { obtenerServicios } from "./_lib/servicios.js";
import { esVitrinaComercial } from "../middleware.js";
import { obtenerProveedorPagos } from "./_lib/pagos/proveedor.js";

const json = (data, status) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
let agente, proveedor;

export const POST = (request) => {
  if (!esVitrinaComercial(request.url)) return json({ error: "No encontrado" }, 404);
  if (process.env.NOTARIA_ID !== TENANT_VENTAS) {
    console.error(`El chat de ventas necesita NOTARIA_ID=${TENANT_VENTAS} en el proyecto comercial.`);
    return json({ error: "El chat de SOFIA PreFirma no está disponible por ahora. Inténtalo más tarde." }, 503);
  }
  const { almacen, avisar, env } = obtenerServicios();
  agente ||= crearAgenteVentas({ claude: new Anthropic({ timeout: 60 * 1000, maxRetries: 1 }), almacen, avisar,
    whatsapp: String(env.VENTAS_WHATSAPP || "").replace(/\D/g, "") });
  if (proveedor === undefined) proveedor = obtenerProveedorPagos(env);
  return crearManejadorVentas({ agente, almacen, avisar, proveedor }).POST(request);
};
