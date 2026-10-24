// Antes del primer mensaje del chat web: dos casillas separadas, términos y tratamiento de datos (LOPDP, art. 8).
// La aceptación se recuerda en este navegador hasta que cambie la versión de alguno de los dos textos.
import { AVISO_PRIVACIDAD, TERMINOS } from "./legal.js";

// Cada sitio tiene sus propios textos legales: la notaría y SOFIA PreFirma usan la misma lógica con distintos enlaces.
export function crearAceptacion({ clave, aviso, terminos, enlaceTerminos, enlacePrivacidad }) {
  let enMemoria = false;
  function aceptado() {
    if (enMemoria) return true;
    try { const a = JSON.parse(localStorage.getItem(clave)); return !!a && a.aviso === aviso && a.terminos === terminos; }
    catch (e) { return false; }
  }
  function guardar() {
    enMemoria = true;
    try { localStorage.setItem(clave, JSON.stringify({ aviso, terminos, en: new Date().toISOString() })); } catch (e) {}
  }
  // Lo que viaja con cada mensaje para que el servidor deje constancia.
  const banderas = () => (aceptado() ? { aceptaTerminos: true, aceptaDatos: true } : {});

  // Pone las casillas justo antes del formulario del chat. Devuelve una función que dice si ya se puede enviar.
  function montar(form, clase) {
    let caja = null;
    const pintar = () => {
      if (aceptado() || caja) return;
      caja = document.createElement("fieldset");
      caja.className = clase;
      caja.innerHTML = '<legend>Antes de empezar</legend>' +
        `<label><input type="checkbox" name="aceptaTerminos"> <span>Acepto los <a href="${enlaceTerminos}" target="_blank" rel="noopener">términos y condiciones</a>.</span></label>` +
        `<label><input type="checkbox" name="aceptaDatos"> <span>Autorizo el tratamiento de mis datos según el <a href="${enlacePrivacidad}" target="_blank" rel="noopener">aviso de privacidad</a>, incluido su procesamiento por proveedores con servidores fuera del Ecuador.</span></label>` +
        '<p class="aceptacion__error" role="alert" hidden>Marca las dos casillas para empezar a chatear.</p>';
      form.before(caja);
    };
    pintar();
    return {
      puedeEnviar() {
        if (aceptado()) return true;
        pintar();
        const ok = [...caja.querySelectorAll("input")].every((i) => i.checked);
        caja.querySelector(".aceptacion__error").hidden = ok;
        if (!ok) { caja.querySelector("input:not(:checked)").focus(); return false; }
        guardar(); caja.remove(); caja = null;
        return true;
      },
      // Si el servidor pide aceptar otra vez (cambió la versión o se borró el navegador), se vuelven a mostrar.
      pedirOtraVez() { enMemoria = false; try { localStorage.removeItem(clave); } catch (e) {} pintar(); }
    };
  }
  return { aceptado, banderas, montar };
}

const notaria = crearAceptacion({ clave: "n41-acepta", aviso: AVISO_PRIVACIDAD, terminos: TERMINOS,
  enlaceTerminos: "terminos.html", enlacePrivacidad: "privacidad.html" });
export const aceptado = notaria.aceptado;
export const banderasAceptacion = notaria.banderas;
export const montarAceptacion = notaria.montar;
