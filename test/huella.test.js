import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { huellaIp, ipDe } from "../api/_lib/huella.js";

const SECRETO = "secreto-para-huellas-de-ip-de-32-bytes";
const pedido = (xff, vercel) => new Request("https://ejemplo.test/", { headers: {
  ...(xff ? { "x-forwarded-for": xff } : {}), ...(vercel ? { "x-vercel-forwarded-for": vercel } : {})
} });

describe("huella de IP", () => {
  it("valida la IP y guarda un HMAC por tenant, nunca la dirección en claro", () => {
    const env = { HUELLA_IP_SECRETO: SECRETO, NOTARIA_ID: "notaria41" };
    expect(ipDe(pedido("190.152.10.20, 10.0.0.1"), env)).toBe("190.152.10.20");
    expect(ipDe(pedido("no-es-ip"), env)).toBe("desconocida");
    const h = huellaIp(pedido("190.152.10.20, 10.0.0.1"), env);
    expect(h).toBe(createHmac("sha256", SECRETO).update("notaria41|190.152.10.20").digest("hex").slice(0, 32));
    expect(h).not.toContain("190");
    expect(huellaIp(pedido("190.152.10.20"), { ...env, NOTARIA_ID: "notaria12" })).not.toBe(h);
  });

  it("en Vercel ignora X-Forwarded-For y usa solo la cabecera de la plataforma", () => {
    const env = { VERCEL: "1", VERCEL_ENV: "production", HUELLA_IP_SECRETO: SECRETO, NOTARIA_ID: "notaria41" };
    const request = pedido("203.0.113.8", "190.152.10.20");
    expect(ipDe(request, env)).toBe("190.152.10.20");
    expect(huellaIp(request, env)).toBe(createHmac("sha256", SECRETO).update("notaria41|190.152.10.20").digest("hex").slice(0, 32));
  });

  it("falla cerrada en producción sin secreto fuerte o sin IP válida de Vercel", () => {
    const env = { VERCEL: "1", VERCEL_ENV: "production", NOTARIA_ID: "notaria41", HUELLA_IP_SECRETO: SECRETO };
    expect(() => huellaIp(pedido("190.152.10.20"), env)).toThrow(/IP válida/);
    expect(() => huellaIp(pedido(null, "190.152.10.20"), { ...env, HUELLA_IP_SECRETO: "débil" })).toThrow(/32 bytes/);
  });
});
