// Turnero de la notaría: https://<dominio>/api/turnos (página turno.html y pantalla sala.html).
import { crearManejadorTurnos } from "./_lib/turnos.js";
import { obtenerServicios } from "./_lib/servicios.js";

const manejador = () => crearManejadorTurnos({ almacen: obtenerServicios().almacen });
export const GET = (request) => manejador().GET(request);
export const POST = (request) => manejador().POST(request);
