// Huella de la IP de un pedido para los límites de uso: se guarda un HMAC, nunca la IP en claro.
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { notariaDe } from "./notaria.js";

const SECRETO_LOCAL = "solo-desarrollo-huella-ip-no-produccion";
const enVercel = (env) => env.VERCEL === "1" || !!env.VERCEL_ENV;
const secretoValido = (v) => typeof v === "string" && Buffer.byteLength(v, "utf8") >= 32;

export function ipDe(request, env = process.env) {
  // Vercel sobrescribe esta cabecera en el borde. No se confía en X-Forwarded-For en producción porque un proxy
  // situado delante de Vercel podría reemplazarlo; X-Vercel-Forwarded-For conserva el valor de la plataforma.
  const nombre = enVercel(env) ? "x-vercel-forwarded-for" : "x-forwarded-for";
  const ip = (request.headers.get(nombre) || "").split(",")[0].trim();
  return isIP(ip) ? ip : "desconocida";
}

export function huellaIp(request, env = process.env) {
  const produccion = env.VERCEL_ENV === "production";
  const secreto = env.HUELLA_IP_SECRETO || (!produccion ? SECRETO_LOCAL : "");
  if (!secretoValido(secreto)) throw new Error("Falta HUELLA_IP_SECRETO: debe tener al menos 32 bytes");
  const ip = ipDe(request, env);
  if (produccion && ip === "desconocida") throw new Error("Vercel no proporcionó una IP válida");
  return createHmac("sha256", secreto).update(notariaDe(request, env) + "|" + ip).digest("hex").slice(0, 32);
}
