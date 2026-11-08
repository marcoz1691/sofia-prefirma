import { it, expect, vi } from "vitest";
import { crearPanel } from "../api/_lib/panel.js";
import { crearAlmacenMemoria } from "../api/_lib/almacen-memoria.js";
import { crearManejadorVentas } from "../api/_lib/ventas-http.js";
import { sistemaVentas, PLANES } from "../api/_lib/catalogo-ventas.js";

it("el panel informa el plan de la notaría para invitar a activar a Sofía", async () => {
  const almacen = crearAlmacenMemoria({ personal: [{ email: "notario@ejemplo.ec", nombre: "Ana", rol: "notario" }] });
  const panel = crearPanel({ almacen, whatsapp: {}, contenido: async () => ({}) });
  expect((await panel.yo("notario@ejemplo.ec")).plan).toBe("");
  await almacen.guardarAjuste("plan", "Vitrina", "admin@sofiaprefirma.com");
  expect((await panel.yo("notario@ejemplo.ec")).plan).toBe("Vitrina");
});

it("Sofía presenta Vitrina a USD 29 y la oferta de notarías fundadoras", () => {
  expect(PLANES.at(-1)).toMatchObject({ nombre: "Vitrina", mensual: 29 });
  const s = sistemaVentas();
  expect(s).toContain("Vitrina (Tu notaría, abierta en línea): USD 29 al mes");
  expect(s).toContain("las primeras 5 notarías que contraten no pagan la configuración inicial");
  expect(s).toContain("nunca «activación»");
  expect(s).toContain("Turnos en la notaría: QR en la entrada");
    expect(s).not.toContain("USD 0 al mes");
});

it("la solicitud de Vitrina se registra sin mes de prueba", async () => {
  const almacen = crearAlmacenMemoria();
  const m = crearManejadorVentas({ agente: {}, almacen, ahora: () => 1_000_000 });
  const r = await m.POST(new Request("https://sofiaprefirma.com/api/ventas", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "190.1.1.1" },
    body: JSON.stringify({ accion: "solicitar", nombre: "Pedro Mora", notaria: "Notaría 3 de Loja", telefono: "0987654321", plan: "Vitrina", periodo: "anual", aceptaTerminos: true, aceptaDatos: true }) }));
  expect(r.status).toBe(200);
  expect((await almacen.prospectos())[0]).toMatchObject({ plan: "Vitrina", detalle: "Vitrina · pago anual" });
});

it("el plan Entrada se registra sin mes de prueba y Sofía lo sabe", async () => {
  const almacen = crearAlmacenMemoria();
  const m = crearManejadorVentas({ agente: {}, almacen, ahora: () => 1_000_000 });
  const r = await m.POST(new Request("https://sofiaprefirma.com/api/ventas", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "190.1.1.2" },
    body: JSON.stringify({ accion: "solicitar", nombre: "Pedro Mora", notaria: "Notaría 3 de Loja", telefono: "0987654321", plan: "Entrada", periodo: "mensual", aceptaTerminos: true, aceptaDatos: true }) }));
  expect(r.status).toBe(200);
  expect((await almacen.prospectos())[0]).toMatchObject({ plan: "Entrada", detalle: "Sin mes de prueba · pago mensual" });
  const s = sistemaVentas();
  expect(s).toContain("el primer mes es gratis con el plan PreFirma o superior (desde USD 119)");
  expect(s).toContain("no la menciones por iniciativa propia");
});
