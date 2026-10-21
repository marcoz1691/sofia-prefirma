import { describe, expect, it } from "vitest";
import { correoCodigo } from "../api/_lib/correos-cliente.js";

describe("correos públicos del portal", () => {
  it("solo usa los campos públicos esperados y nunca incorpora una nota interna adicional", () => {
    const marca = "INTERNA_NO_ENVIAR: validar identidad antes de atender";
    const correo = correoCodigo({
      codigo: "482193",
      notaria: "Notaría 41 de Quito",
      nota: marca,
      notaInterna: marca,
      motivo: marca
    });
    const salida = JSON.stringify(correo);
    expect(salida).toContain("482193");
    expect(salida).toContain("Notaría 41 de Quito");
    expect(salida).not.toContain("INTERNA_NO_ENVIAR");
    expect(salida).not.toContain("validar identidad");
  });
});
