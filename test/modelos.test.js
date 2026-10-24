import { describe, it, expect } from "vitest";
import { elegirModelo, textosDeCliente, COMPLEJO_VENTAS } from "../api/_lib/modelos.js";
import { costoIa, PRECIOS } from "../api/_lib/metricas.js";

describe("elección de modelo", () => {
  it("las consultas comunes van al modelo rápido", () => {
    expect(elegirModelo({ textos: ["¿Cuánto cuesta una declaración juramentada?", "¿Qué requisitos tiene un poder?"] }))
      .toMatchObject({ modelo: "claude-sonnet-5-5", avanzado: false });
  });

  it("escala por caso complejo, documentos o mensaje largo", () => {
    expect(elegirModelo({ textos: ["Quiero constituir una compañía con dos socios"] }).motivo).toBe("caso complejo");
    expect(elegirModelo({ textos: ["Tengo una queja con la atención"] }).avanzado).toBe(true);
    expect(elegirModelo({ textos: ["hola"], conDocumentos: true }).motivo).toBe("documentos");
    expect(elegirModelo({ textos: ["a".repeat(701)] }).motivo).toBe("mensaje largo");
  });

  it("el chat de ventas usa sus propias señales", () => {
    expect(elegirModelo({ textos: ["¿Qué plan me conviene?"], patron: COMPLEJO_VENTAS }).avanzado).toBe(false);
    expect(elegirModelo({ textos: ["¿Se integra por API con nuestro sistema?"], patron: COMPLEJO_VENTAS }).avanzado).toBe(true);
  });

  it("solo cuenta lo que escribió el cliente", () => {
    expect(textosDeCliente([
      { role: "user", content: "hola" },
      { role: "system", content: "herencia" },
      { role: "assistant", content: [{ type: "text", text: "testamento" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "sociedad" }] }
    ])).toEqual(["hola"]);
  });
});

it("el costo suma cada modelo a su precio", () => {
  const millon = 1e6;
  expect(costoIa({ "ia.tokens_salida": millon, "ia.rapido.tokens_salida": millon }, PRECIOS)).toBe(30);
});
