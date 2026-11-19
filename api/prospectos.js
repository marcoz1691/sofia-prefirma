// Tablero de prospectos de SOFIA PreFirma: https://sofiaprefirma.com/api/prospectos
// Solo existe en el proyecto comercial (tenant «sofia-ventas»); en el de una notaría responde 404.
import { crearManejadorProspectos } from "./_lib/prospectos-http.js";
import { TENANT_VENTAS } from "./_lib/catalogo-ventas.js";
import { obtenerServicios } from "./_lib/servicios.js";

const json = (data, status) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
let instancia = null;
const manejador = () => instancia ||= (() => {
  const { almacen, env } = obtenerServicios();
  return crearManejadorProspectos({ almacen, exigirMfa: env.PANEL_MFA !== "desactivada",
    config: { supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY } });
})();
const soloVentas = (fn) => (request) => process.env.NOTARIA_ID === TENANT_VENTAS ? fn(request) : json({ error: "No encontrado" }, 404);

export const GET = soloVentas((request) => manejador().GET(request));
export const POST = soloVentas((request) => manejador().POST(request));
