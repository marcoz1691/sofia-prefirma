const botonesPeriodo = [...document.querySelectorAll("[data-periodo]")];
const planes = [...document.querySelectorAll(".plan[data-mensual]")];

function mostrarPeriodo(periodo) {
  botonesPeriodo.forEach(boton => boton.setAttribute("aria-pressed", String(boton.dataset.periodo === periodo)));
  planes.forEach(plan => {
    const mensual = Number(plan.dataset.mensual);
    const precio = plan.querySelector(".plan__precio strong");
    const factura = plan.querySelector(".plan__factura");
    if (mensual === 0) {
      factura.textContent = "Para siempre · sin tarjeta";
    } else if (periodo === "anual") {
      precio.textContent = Math.round(mensual * 10 / 12);
      factura.textContent = `Equivale a USD ${mensual * 10} al año · activación incluida`;
    } else {
      precio.textContent = mensual;
      factura.textContent = "Facturación mensual";
    }
  });
}

botonesPeriodo.forEach(boton => boton.addEventListener("click", () => mostrarPeriodo(boton.dataset.periodo)));

const botonesCaso = [...document.querySelectorAll("[data-caso]")];
const casos = {
  compraventa: {
    pregunta: "Necesito vender una casa. ¿Qué debo llevar?",
    respuesta: "Primero revisemos quién vende, quién compra y si hay hipoteca. Con esas respuestas prepararé tu lista exacta.",
    avance: "3 datos por confirmar",
  },
  poder: {
    pregunta: "Necesito dejar un poder antes de viajar.",
    respuesta: "Te preguntaré para qué acto servirá, quién lo recibe y si necesitas facultades especiales. Así evitamos una minuta incompleta.",
    avance: "2 decisiones pendientes",
  },
  sociedad: {
    pregunta: "Vamos a constituir una compañía. ¿Cómo empezamos?",
    respuesta: "Reuniré los datos de los socios, la actividad y el capital. El equipo notarial recibirá el caso ordenado para revisarlo.",
    avance: "4 datos por completar",
  },
};

function mostrarCaso(nombre) {
  const caso = casos[nombre];
  if (!caso) return;
  botonesCaso.forEach(boton => boton.setAttribute("aria-pressed", String(boton.dataset.caso === nombre)));
  const elementos = ["#demo-pregunta", "#demo-respuesta", "#demo-avance"].map(id => document.querySelector(id));
  [elementos[0].textContent, elementos[1].textContent, elementos[2].textContent] = [caso.pregunta, caso.respuesta, caso.avance];
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    elementos.forEach((elemento, indice) => elemento.animate([
      { opacity: .35, transform: "translateY(8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: 360, delay: indice * 65, easing: "cubic-bezier(.22,.75,.2,1)" }));
  }
}

botonesCaso.forEach(boton => boton.addEventListener("click", () => mostrarCaso(boton.dataset.caso)));

const compartir = document.querySelector("#compartir");
compartir.addEventListener("click", async () => {
  const datos = { title: document.title, text: "Conoce Sofía PreFirma: cada trámite, listo para avanzar.", url: location.href };
  try {
    if (navigator.share) await navigator.share(datos);
    else {
      await navigator.clipboard.writeText(location.href);
      compartir.innerHTML = '<i class="ph ph-check" aria-hidden="true"></i> Enlace copiado';
      setTimeout(() => compartir.innerHTML = '<i class="ph ph-share-network" aria-hidden="true"></i> Compartir propuesta', 2200);
    }
  } catch (error) {
    if (error.name !== "AbortError") compartir.textContent = "Copia el enlace del navegador";
  }
});

document.querySelector("#imprimir").addEventListener("click", () => window.print());

// «Elegir plan» abre una ventana con el resumen del plan y el formulario del mes gratis.
const eleccion = document.querySelector("#eleccion");
const formEleccion = document.querySelector("#eleccion-form");
const errorEleccion = document.querySelector("#eleccion-error");
let planElegido = null, periodoElegido = "mensual";

const PASOS_PRUEBA = ["Nos dejas tus datos.", "En un día hábil te llamamos y vemos una demostración con tus trámites.", "Configuramos tu marca, trámites y WhatsApp.", "Usas Sofía 30 días gratis y decides si continúas."];
const PASOS_VITRINA = ["Nos dejas tus datos.", "Cargamos tu catálogo de trámites y tarifas.", "Publicamos tu web con tu marca.", "Cuando quieras, activas a Sofía y empiezas tu mes de prueba."];

function pintarEleccion() {
  const mensual = Number(planElegido.dataset.mensual);
  const vitrina = mensual === 0;
  const anual = periodoElegido === "anual" && !vitrina;
  document.querySelector("#eleccion-oferta").hidden = vitrina;
  document.querySelector("#eleccion-periodo").hidden = vitrina;
  document.querySelector("#eleccion-moneda").hidden = vitrina;
  document.querySelector(".eleccion__precio").classList.toggle("eleccion__precio--texto", vitrina);
  document.querySelector("#eleccion-sufijo").textContent = vitrina ? "" : "/ mes después de la prueba";
  document.querySelector("#eleccion-form-titulo").textContent = vitrina ? "Abre tu Vitrina" : "Empieza tu mes gratis";
  document.querySelector("#eleccion-pasos").innerHTML = (vitrina ? PASOS_VITRINA : PASOS_PRUEBA).map(p => `<li>${p}</li>`).join("");
  document.querySelector("#eleccion-enviar").textContent = vitrina ? "Abrir mi Vitrina" : "Empezar mi mes gratis";
  document.querySelector("#eleccion-titulo").textContent = planElegido.dataset.plan;
  document.querySelector("#eleccion-lema").textContent = planElegido.querySelector("header h3").textContent;
  document.querySelector("#eleccion-precio").textContent = vitrina ? "Sin mensualidad" : anual ? Math.round(mensual * 10 / 12) : mensual;
  document.querySelector("#eleccion-factura").textContent = vitrina ? "Para siempre · sin tarjeta" : anual
    ? `USD ${mensual * 10} al año · activación incluida`
    : "Facturación mensual · la activación se cotiza una sola vez";
  document.querySelector("#eleccion-incluye").innerHTML = planElegido.querySelector("ul").innerHTML;
  eleccion.querySelectorAll("[data-e-periodo]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.ePeriodo === periodoElegido)));
}

function mostrarErrorEleccion(texto, campo) {
  errorEleccion.textContent = texto;
  errorEleccion.hidden = !texto;
  const destino = campo === "acepta" ? formEleccion.querySelector("input[type=checkbox]:not(:checked)") : campo && formEleccion.elements[campo];
  if (destino) destino.focus();
}

document.querySelectorAll(".elegir-plan").forEach(enlace => {
  enlace.addEventListener("click", (evento) => {
    if (typeof eleccion?.showModal !== "function") return;
    evento.preventDefault();
    planElegido = enlace.closest(".plan");
    periodoElegido = botonesPeriodo.find(b => b.getAttribute("aria-pressed") === "true")?.dataset.periodo || "mensual";
    formEleccion.hidden = false;
    document.querySelector("#eleccion-listo").hidden = true;
    mostrarErrorEleccion("");
    pintarEleccion();
    eleccion.showModal();
    eleccion.scrollTop = 0;
    if (window.matchMedia("(min-width: 761px)").matches) formEleccion.elements.nombre.focus();
  });
});

eleccion?.querySelectorAll("[data-e-periodo]").forEach(boton => boton.addEventListener("click", () => { periodoElegido = boton.dataset.ePeriodo; pintarEleccion(); }));
eleccion?.addEventListener("click", (evento) => { if (evento.target === eleccion) eleccion.close(); });
eleccion?.querySelector("[data-abrir-chat]").addEventListener("click", () => eleccion.close());

formEleccion?.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const datos = Object.fromEntries(new FormData(formEleccion));
  if (!datos.nombre.trim()) return mostrarErrorEleccion("Escribe tu nombre.", "nombre");
  if (!datos.notaria.trim()) return mostrarErrorEleccion("Escribe el nombre o número de tu notaría.", "notaria");
  if (datos.telefono.replace(/\D/g, "").length < 7) return mostrarErrorEleccion("Escribe un celular válido para contactarte.", "telefono");
  if (!formEleccion.elements.aceptaTerminos.checked || !formEleccion.elements.aceptaDatos.checked) return mostrarErrorEleccion("Marca las dos casillas para enviar tu solicitud.", "acepta");
  const boton = document.querySelector("#eleccion-enviar");
  boton.disabled = true; boton.textContent = "Enviando…";
  mostrarErrorEleccion("");
  try {
    const r = await fetch("/api/ventas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      accion: "solicitar", nombre: datos.nombre, notaria: datos.notaria, ciudad: datos.ciudad, cargo: datos.cargo, telefono: datos.telefono, correo: datos.correo,
      plan: planElegido.dataset.plan, periodo: periodoElegido, aceptaTerminos: true, aceptaDatos: true }) });
    const respuesta = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(respuesta.error || "No pudimos enviar tu solicitud. Inténtalo de nuevo en unos minutos."), { campo: respuesta.campo });
    formEleccion.hidden = true;
    const listo = document.querySelector("#eleccion-listo");
    document.querySelector("#eleccion-listo-titulo").textContent = `Listo, ${datos.nombre.trim().split(" ")[0]}.`;
    document.querySelector("#eleccion-listo-texto").textContent = `Recibimos tu solicitud del plan ${planElegido.dataset.plan}. En un día hábil te escribiremos al ${datos.telefono.trim()} para ${Number(planElegido.dataset.mensual) === 0 ? "cargar tu catálogo y publicar tu Vitrina" : "coordinar la demostración y activar tu mes gratis"}.`;
    listo.hidden = false; listo.focus();
    formEleccion.reset();
  } catch (error) {
    mostrarErrorEleccion(error instanceof TypeError ? "Sin conexión. Revisa tu internet e inténtalo de nuevo." : error.message, error.campo);
  } finally {
    boton.disabled = false; boton.textContent = Number(planElegido.dataset.mensual) === 0 ? "Abrir mi Vitrina" : "Empezar mi mes gratis";
  }
});
mostrarPeriodo("mensual");
