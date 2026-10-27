import { it, expect } from "vitest";
import { crearPanel } from "../api/_lib/panel.js";
import { crearAlmacenMemoria } from "../api/_lib/almacen-memoria.js";

const personal = [{ email: "ana@ejemplo.ec", nombre: "Ana", rol: "admin" }];

it("cada producto recibe su modo del panel", async () => {
  const almacen = crearAlmacenMemoria({ personal });
  const notaria = crearPanel({ almacen, contenido: async () => ({}) });
  const ventas = crearPanel({ almacen, contenido: async () => ({}), producto: "ventas" });
  expect((await notaria.yo("ana@ejemplo.ec")).producto).toBe("notaria");
  expect((await ventas.yo("ana@ejemplo.ec")).producto).toBe("ventas");
});

it("los prospectos de SOFIA se listan en su panel", async () => {
  const almacen = crearAlmacenMemoria({ personal });
  await almacen.guardarProspecto({ conversacionId: null, nombre: "Lucía", notaria: "N12", ciudad: "Cuenca", cargo: "", telefono: "0991234567", correo: "", plan: "PreFirma", motivo: "demostracion", detalle: "" });
  const ventas = crearPanel({ almacen, contenido: async () => ({}), producto: "ventas" });
  const { prospectos } = await ventas.prospectos();
  expect(prospectos).toHaveLength(1);
  expect(prospectos[0]).toMatchObject({ nombre: "Lucía", plan: "PreFirma", motivo: "demostracion" });
});
