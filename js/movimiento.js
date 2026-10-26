// Movimiento de la página comercial: entrada del inicio, apariciones en secuencia al bajar, la frase del problema que se
// enciende palabra por palabra, el recorrido que avanza con el desplazamiento y un paralaje suave del teléfono.
// Sin JavaScript todo queda visible y completo. Con «Reducir movimiento» solo cambia la opacidad: nada se desplaza.
(() => {
  const reducir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const EXPO = "cubic-bezier(.16,1,.3,1)";   // easeOutExpo (easings.net)
  const QUART = "cubic-bezier(.25,1,.5,1)";  // easeOutQuart (easings.net)
  const $ = (s, raiz = document) => raiz.querySelector(s);
  const $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];
  const entrar = (el, retraso = 0, distancia = 28) => el.animate(
    reducir ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, translate: `0 ${distancia}px` }, { opacity: 1, translate: "0 0" }],
    { duration: reducir ? 500 : 900, delay: retraso, easing: EXPO, fill: "backwards" });

  // 1. Entrada del inicio, en secuencia.
  const hero = $(".hero");
  if (hero) {
    const piezas = [".sobretitulo", "h1", ".hero__bajada", ".hero__acciones", ".hero__sellos"].map((s) => $(s, hero)).filter(Boolean);
    piezas.forEach((el, i) => {
      if (el.tagName === "H1" && !reducir) el.animate([{ clipPath: "inset(0 0 100% 0)", translate: "0 40px" }, { clipPath: "inset(0 0 0 0)", translate: "0 0" }],
        { duration: 1100, delay: 120 + i * 110, easing: EXPO, fill: "backwards" });
      else entrar(el, 120 + i * 110, 18);
    });
    const telefono = $(".telefono", hero);
    if (telefono) telefono.animate(reducir ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, translate: "0 70px", rotate: "4deg" }, { opacity: 1, translate: "0 0", rotate: "0deg" }],
      { duration: reducir ? 600 : 1300, delay: 420, easing: EXPO, fill: "backwards" });
  }

  // 2. Apariciones al bajar: cada bloque muestra sus partes una tras otra.
  const PARTES = { problema__lista: "article", suite: ".suite__presentacion, .suite__modulos > article", pasos: "li", calidad__grid: "article",
    planes__grid: ".plan", incluido__grid: ":scope > div", extras: "article", piloto__pasos: ":scope > div" };
  const partesDe = (bloque) => {
    const clave = Object.keys(PARTES).find((c) => bloque.classList.contains(c));
    const partes = $$(clave ? PARTES[clave] : ":scope > *", bloque);
    return partes.length > 1 ? partes : [bloque];
  };
  // Cada parte se vigila por separado y su animación empieza un poco antes de entrar a la pantalla: así nunca se ve
  // completa, desaparece y vuelve (el parpadeo que se notaba al bajar). Lo que ya está a la vista al cargar no se anima.
  const revelar = $$(".revelar");
  if ("IntersectionObserver" in window) {
    const observador = new IntersectionObserver((entradas) => {
      const nuevas = entradas.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      nuevas.forEach((e, i) => { entrar(e.target, Math.min(i, 5) * 80); observador.unobserve(e.target); });
    }, { rootMargin: "0px 0px 15% 0px" });
    for (const bloque of revelar) {
      bloque.classList.add("visible");
      for (const parte of partesDe(bloque)) if (parte.getBoundingClientRect().top > innerHeight) observador.observe(parte);
    }
  } else revelar.forEach((el) => el.classList.add("visible"));

  // 3. La frase del problema se enciende palabra por palabra mientras se lee.
  const frase = $(".problema__frase h2");
  let palabras = [];
  if (frase) {
    frase.setAttribute("aria-label", frase.textContent.trim());
    const texto = frase.textContent.trim().split(/\s+/);
    frase.replaceChildren(...texto.flatMap((p, i) => {
      const s = document.createElement("span");
      s.className = "palabra"; s.setAttribute("aria-hidden", "true"); s.textContent = p;
      return i ? [" ", s] : [s];
    }));
    palabras = $$(".palabra", frase);
    frase.classList.add("encender");
  }

  // 4. El recorrido avanza con el desplazamiento y cada paso se ilumina al alcanzarlo.
  const pasos = $(".pasos");
  const listaPasos = pasos ? $$("li", pasos) : [];
  if (pasos) pasos.classList.add("pasos--animado");

  const telefono = $(".hero .telefono");
  const acotar = (x) => Math.min(1, Math.max(0, x));
  let pendiente = false;
  const actualizar = () => {
    pendiente = false;
    const alto = innerHeight;
    if (palabras.length) {
      const r = frase.getBoundingClientRect();
      const avance = acotar((alto * .82 - r.top) / (alto * .5));
      const encendidas = Math.round(avance * palabras.length);
      palabras.forEach((p, i) => p.classList.toggle("encendida", i < encendidas));
    }
    if (pasos) {
      const r = pasos.getBoundingClientRect();
      const avance = acotar((alto * .85 - r.top) / (r.height + alto * .3));
      pasos.style.setProperty("--avance", avance.toFixed(3));
      listaPasos.forEach((li, i) => li.classList.toggle("activo", avance >= i / listaPasos.length + .04));
    }
    if (telefono && !reducir && innerWidth > 960) telefono.style.translate = `0 ${(acotar(scrollY / alto) * 45).toFixed(1)}px`;
  };
  addEventListener("scroll", () => { if (!pendiente) { pendiente = true; requestAnimationFrame(actualizar); } }, { passive: true });
  addEventListener("resize", actualizar);
  actualizar();
})();
