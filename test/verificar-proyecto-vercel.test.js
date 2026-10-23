import { describe, expect, it } from "vitest";
import { DESTINOS_VERCEL, validarConfiguracionVercel, validarProyectoVercel } from "../scripts/verificar-proyecto-vercel.mjs";

describe("verificación previa del proyecto Vercel", () => {
  it.each(["comercial", "piloto"])("acepta el vínculo exacto del destino %s", (destino) => {
    expect(validarProyectoVercel(destino, DESTINOS_VERCEL[destino])).toEqual(DESTINOS_VERCEL[destino]);
  });

  it("bloquea el proyecto institucional aunque se solicite el piloto", () => {
    expect(() => validarProyectoVercel("piloto", {
      projectName: "notaria41",
      projectId: "prj_T8dGbvUsMkgx2Cs965yFc9oCvqta",
    })).toThrow(/Despliegue bloqueado/);
  });

  it("bloquea nombres correctos con un projectId distinto", () => {
    expect(() => validarProyectoVercel("comercial", {
      projectName: "sofiaprefirma",
      projectId: "prj_equivocado",
    })).toThrow(/projectId/);
  });

  it("rechaza destinos no registrados", () => {
    expect(() => validarProyectoVercel("produccion", DESTINOS_VERCEL.comercial)).toThrow(/Destino desconocido/);
  });

  it.each(["comercial", "piloto"])("bloquea cron jobs en %s mientras está en preparación", (destino) => {
    expect(() => validarConfiguracionVercel(destino, {
      crons: [{ path: "/api/purgar", schedule: "0 8 * * *" }],
    })).toThrow(/no puede registrar cron jobs/);
  });

  it("permite ambos destinos sin cron jobs", () => {
    expect(validarConfiguracionVercel("piloto", { crons: [] })).toEqual({ crons: [] });
    expect(validarConfiguracionVercel("comercial", { crons: [] })).toEqual({ crons: [] });
  });
});
