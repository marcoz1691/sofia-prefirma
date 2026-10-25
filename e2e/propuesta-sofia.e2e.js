import { test, expect } from "@playwright/test";

test("la propuesta presenta la suite Sofía y sus planes", async ({ page }) => {
  await page.goto("/propuesta-sofia.html");
  await expect(page).toHaveTitle(/Sofía PreFirma/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("trámite listo para avanzar");
  await expect(page.getByText("Notaría 41")).toHaveCount(0);
  await expect(page.getByText("miNotarIA")).toHaveCount(0);
  await expect(page.locator(".suite h3")).toHaveText(["Antesala", "Alista", "Clara", "Pronta", "Nexo", "Lúcida"]);
  await expect(page.locator(".plan__precio strong")).toHaveText(["Sin mensualidad", "59", "119", "149", "179", "229"]);
  await expect(page.locator(".plan--recomendado")).toContainText("PreFirma");
  await expect(page.getByRole("button", { name: /Guardar en PDF/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "De la demostración a una primera etapa controlada." })).toBeVisible();
  await expect(page.locator(".piloto__pasos > div")).toHaveCount(4);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "assets/logo/sofia-prefirma-oficial-simbolo.svg");
});

test("el chat de ventas pide las dos casillas y muestra la respuesta de Sofía", async ({ page }) => {
  let cuerpo;
  await page.route("**/api/ventas", async (ruta) => {
    cuerpo = ruta.request().postDataJSON();
    await ruta.fulfill({ json: { respuestas: ["Para una notaría con un solo equipo te recomiendo *PreFirma*: USD 119 al mes más IVA."] } });
  });
  await page.goto("/propuesta-sofia.html");
  await page.getByRole("button", { name: "Habla con Sofía" }).click();
  await expect(page.locator("#vchat")).toBeVisible();
  await page.getByRole("button", { name: "¿Qué plan me conviene?" }).click();
  await expect(page.locator(".vchat__aceptacion .aceptacion__error")).toBeVisible();
  await page.getByRole("checkbox", { name: /términos/ }).check();
  await page.getByRole("checkbox", { name: /tratamiento de mis datos/ }).check();
  await page.getByRole("button", { name: "¿Qué plan me conviene?" }).click();
  await expect(page.locator(".vchat__texto").last()).toContainText("PreFirma");
  expect(cuerpo).toMatchObject({ texto: "¿Qué plan me conviene para mi notaría?", aceptaTerminos: true, aceptaDatos: true });
  await expect(page.locator('.vchat__aceptacion a[href="prefirma-privacidad.html"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#vchat")).toBeHidden();
});

test("la demostración de Sofía responde según el trámite", async ({ page }) => {
  await page.goto("/propuesta-sofia.html");
  await page.getByRole("button", { name: "Poder" }).click();
  await expect(page.locator("#demo-pregunta")).toContainText("poder");
  await expect(page.locator("#demo-avance")).toHaveText("2 decisiones pendientes");
  await expect(page.getByRole("button", { name: "Poder" })).toHaveAttribute("aria-pressed", "true");
});

test("el contenido no depende del desplazamiento ni de la animación para ser visible", async ({ page }) => {
  await page.goto("/propuesta-sofia.html");
  await expect(page.locator("#piloto .revelar").first()).toHaveCSS("opacity", "1");
});

test("el pago anual muestra dos meses gratis", async ({ page }) => {
  await page.goto("/propuesta-sofia.html");
  await page.getByRole("button", { name: /Anual/ }).click();
  await expect(page.locator(".plan__precio strong")).toHaveText(["Sin mensualidad", "49", "99", "124", "149", "191"]);
  await expect(page.locator(".plan__factura").nth(2)).toContainText("USD 1190 al año");
  await expect(page.getByRole("button", { name: /Anual/ })).toHaveAttribute("aria-pressed", "true");
});

test("@movil la propuesta cabe y conserva planes e integraciones", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Solo aplica al proyecto móvil");
  await page.goto("/propuesta-sofia.html");
  await expect(page.getByText("Prepara expedientes", { exact: true })).toBeVisible();
  await expect(page.getByText("Pagos con tarjeta para tus clientes")).toBeVisible();
  const cabe = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(cabe).toBe(true);
});

test("elegir un plan abre la ventana del mes gratis y envía la solicitud", async ({ page }) => {
  let cuerpo;
  await page.route("**/api/ventas", async (ruta) => { cuerpo = ruta.request().postDataJSON(); await ruta.fulfill({ json: { ok: true, plan: "Equipo", periodo: "anual" } }); });
  await page.goto("/propuesta-sofia.html");
  await page.getByRole("button", { name: /Anual/ }).first().click();
  await page.getByRole("link", { name: "Elegir Equipo" }).click();
  const dialogo = page.getByRole("dialog", { name: "Equipo" });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.locator("#eleccion-precio")).toHaveText("124");
  await expect(dialogo.locator("#eleccion-factura")).toContainText("USD 1490 al año");
  await dialogo.getByRole("button", { name: "Empezar mi mes gratis" }).click();
  await expect(dialogo.locator("#eleccion-error")).toHaveText("Escribe tu nombre.");
  await dialogo.getByLabel("Tu nombre").fill("Lucía Andrade");
  await dialogo.getByLabel("Notaría", { exact: true }).fill("Notaría 12 de Cuenca");
  await dialogo.getByLabel("Celular (WhatsApp)").fill("099 123 4567");
  await dialogo.getByRole("checkbox", { name: /términos/ }).check();
  await dialogo.getByRole("checkbox", { name: /tratamiento de mis datos/ }).check();
  await dialogo.getByRole("button", { name: "Empezar mi mes gratis" }).click();
  await expect(dialogo.locator("#eleccion-listo")).toContainText("Recibimos tu solicitud del plan Equipo");
  await expect(dialogo.getByRole("button", { name: /Pagar con tarjeta · próximamente/ })).toBeDisabled();
  expect(cuerpo).toMatchObject({ accion: "solicitar", plan: "Equipo", periodo: "anual", nombre: "Lucía Andrade", telefono: "099 123 4567", aceptaTerminos: true, aceptaDatos: true });
  await page.keyboard.press("Escape");
  await expect(dialogo).toBeHidden();
});

test("la propuesta tiene una versión limpia para imprimir en PDF", async ({ page }) => {
  await page.goto("/propuesta-sofia.html");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator(".hero__acciones")).toBeHidden();
  await expect(page.locator(".suite")).toBeVisible();
  await expect(page.locator(".planes__grid")).toBeVisible();
});
