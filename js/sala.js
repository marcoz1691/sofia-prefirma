// Pantalla de la sala: muestra el número que se está llamando y los anteriores. Solo números, nunca nombres.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let ultimo = null;

function hora() { $("#sala-hora").textContent = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", hour: "2-digit", minute: "2-digit" }).format(new Date()); }

async function actualizar() {
  try {
    const r = await fetch("/api/turnos?accion=sala");
    const d = await r.json().catch(() => ({}));
    if (r.status === 503) { $("#sala-numero").textContent = "—"; $("#sala-ventanilla").textContent = "Atención por orden de llegada"; return; }
    if (!r.ok) return;
    const [actual, ...antes] = d.llamados || [];
    $("#sala-numero").textContent = actual?.numero || "—";
    $("#sala-ventanilla").textContent = actual ? `Ventanilla ${actual.ventanilla}` : "Toma tu turno con el código QR de la entrada";
    $("#sala-lista").innerHTML = antes.map((t) => `<li><b>${esc(t.numero)}</b><span>Ventanilla ${esc(t.ventanilla)}</span></li>`).join("");
    $("#sala-espera").textContent = d.esperando ? `${d.esperando} ${d.esperando === 1 ? "persona" : "personas"} en espera` : "";
    if (actual && actual.numero !== ultimo) {
      document.body.classList.remove("sala--nuevo"); void document.body.offsetWidth; document.body.classList.add("sala--nuevo");
      ultimo = actual.numero;
    }
  } catch (e) { /* sin conexión: se reintenta */ }
}

hora(); actualizar();
setInterval(hora, 15000);
setInterval(actualizar, 5000);
