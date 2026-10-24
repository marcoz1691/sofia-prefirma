// Pasarela PagoMedios (Abitmedia, Ecuador), API v2. Crea una «solicitud de pago» y devuelve un enlace alojado por
// PagoMedios: la tarjeta nunca pasa por aquí. La notificación (notify_url) no trae una firma pública documentada, así que
// solo se usa como aviso: el estado real siempre se consulta a PagoMedios con nuestro token. Nuestro enlace de aviso
// lleva un HMAC propio para descartar avisos inventados antes de consultar.
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

const ESTADOS_PM = { 0: "pendiente", 1: "pagado", 2: "fallido", 3: "reembolsado" };
const sha256 = (texto) => createHash("sha256").update(texto).digest("hex");

// Cédula: 10 dígitos («05»); RUC: 13 dígitos («04»); pasaporte u otro: «06». Códigos de PagoMedios.
export function tipoDocumento(documento) {
  const d = String(documento || "").replace(/\D/g, "");
  return d.length === 10 ? "05" : d.length === 13 ? "04" : "06";
}

// El monto guardado ya incluye IVA: se separa en base gravada e impuesto como pide la API.
export function desglose(totalCentavos, iva = 0.15) {
  const baseCentavos = Math.round(totalCentavos / (1 + iva));
  return { total: totalCentavos / 100, base: baseCentavos / 100, impuesto: (totalCentavos - baseCentavos) / 100 };
}

export function crearProveedorPagoMedios({ token, secreto, base = "https://api.abitmedia.cloud", fetch = globalThis.fetch, iva = 0.15 }) {
  if (typeof token !== "string" || token.length < 10) throw new Error("Falta PAGOMEDIOS_TOKEN");
  if (typeof secreto !== "string" || secreto.length < 32) throw new Error("PAGOS_SECRETO debe tener al menos 32 caracteres");
  const firmar = (ref) => createHmac("sha256", secreto).update("pagomedios:" + ref).digest("hex");
  const firmaValida = (ref, firma) => /^[0-9a-f]{64}$/.test(firma || "") && timingSafeEqual(Buffer.from(firmar(ref), "hex"), Buffer.from(firma, "hex"));
  // La orden guarda el token de PagoMedios y su enlace: la API entrega el enlace solo al crear la solicitud.
  const separar = (orden) => { const i = String(orden).indexOf("|"); return i < 0 ? { id: orden, url: "" } : { id: orden.slice(0, i), url: orden.slice(i + 1) }; };

  async function llamar(metodo, ruta, cuerpo) {
    const r = await fetch(base + ruta, { method: metodo, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(`PagoMedios respondió ${r.status}${j.message ? ": " + String(j.message).slice(0, 200) : ""}`);
    return j;
  }

  return {
    nombre: "pagomedios",
    pideDocumento: true,
    enlaceAviso(rutaBase, ref) {
      const u = new URL(rutaBase);
      u.searchParams.set("ref", ref);
      u.searchParams.set("firma", firmar(ref));
      return u.href;
    },
    // pago: { id, montoCentavos (con IVA), concepto }; pagador: { documento, nombre, correo, celular, direccion }
    async crearOrden({ pago, pagador = {}, urlAviso }) {
      if (!String(pagador.documento || "").replace(/\D/g, "")) throw new Error("PagoMedios necesita la cédula o el RUC de quien paga");
      const m = desglose(pago.montoCentavos, iva);
      const r = await llamar("POST", "/pagomedios/v2/payment-requests", {
        integration: true,
        third: { document: String(pagador.documento).replace(/\D/g, ""), document_type: tipoDocumento(pagador.documento), name: String(pagador.nombre || "").slice(0, 100),
          email: String(pagador.correo || ""), phones: String(pagador.celular || ""), address: String(pagador.direccion || "Ecuador").slice(0, 200),
          type: String(pagador.documento).replace(/\D/g, "").length === 13 ? "Company" : "Individual" },
        generate_invoice: 0,
        description: String(pago.concepto || "Pago").slice(0, 150),
        amount: m.total, amount_with_tax: m.base, amount_without_tax: 0, tax_value: m.impuesto,
        settings: [], notify_url: urlAviso || null, custom_value: String(pago.id), has_cards: 1, has_cash: 0
      });
      const id = r?.data?.token, url = r?.data?.url;
      if (!id || !/^https:\/\//.test(url || "")) throw new Error("PagoMedios no devolvió el enlace de pago");
      return { orden: `${id}|${url}`, urlCheckout: url };
    },
    async iniciarCheckout({ orden }) {
      const { url } = separar(orden);
      if (!url) throw new Error("La orden no tiene enlace de pago");
      return { urlCheckout: url };
    },
    async consultarPago({ orden }) {
      const { id } = separar(orden);
      const r = await llamar("GET", "/pagomedios/v2/payment-requests?id=" + encodeURIComponent(id));
      const d = Array.isArray(r.data) ? r.data[0] : r.data;
      if (!d) return { estado: null, monto: null, moneda: null };
      return { estado: ESTADOS_PM[d.status] ?? null, monto: d.amount != null ? Math.round(Number(d.amount) * 100) : null, moneda: "USD",
        autorizacion: d.auth_code || null };
    },
    // Aviso de PagoMedios: valida nuestro HMAC sobre la referencia y pide confirmar el estado consultando la API.
    async procesarWebhook(request) {
      const cuerpo = await request.text();
      const cargaHuella = sha256(cuerpo + "|" + request.url);
      const u = new URL(request.url), ref = u.searchParams.get("ref") || "";
      if (!/^[A-Za-z0-9-]{1,64}$/.test(ref) || !firmaValida(ref, u.searchParams.get("firma"))) return { valido: false, cargaHuella };
      return { valido: true, consultar: true, pagoId: ref, tipo: "aviso_pagomedios", cargaHuella };
    }
  };
}
