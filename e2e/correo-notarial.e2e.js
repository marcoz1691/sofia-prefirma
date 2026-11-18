import { test, expect } from "@playwright/test";

test("la notaría revisa si su dominio está libre y pide su correo", async ({ page }) => {
  const cuerpos = [];
  await page.route("**/api/ventas", async (ruta) => {
    const b = ruta.request().postDataJSON();
    cuerpos.push(b);
    if (b.accion === "dominio") return ruta.fulfill({ json: { dominio: "notaria12cuenca.com", correo: "nombre.apellido@notaria12cuenca.com", estado: "libre" } });
    return ruta.fulfill({ json: { ok: true, plan: b.plan, periodo: b.periodo } });
  });
  await page.goto("/correo-notarial.html");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Un correo con el nombre de su notaría");
  await expect(page.getByText(/Consejo|oficio|SISTELNOT/)).toHaveCount(0);
  await expect(page.locator(".correo__desde")).toContainText("Desde USD 14 al mes, IVA incluido");
  await page.getByLabel("Número de su notaría").fill("12");
  await page.getByLabel("Cantón").fill("Cuenca");
  await expect(page.locator("#b-correo")).toHaveText("nombre.apellido@notaria12cuenca.com");
  await page.getByRole("button", { name: "Revisar" }).click();
  await expect(page.locator("#b-resultado")).toContainText("notaria12cuenca.com está libre");
  await expect(page.locator("#p-notaria")).toHaveValue("Notaría 12 de Cuenca");

  await page.locator('[data-elegir="Página web + correo del equipo"]').click();
  await expect(page.getByLabel("Plan")).toHaveValue("Página web + correo del equipo");
  await page.getByLabel("Su nombre").fill("Ana Ruiz");
  await page.getByLabel("Celular (WhatsApp)").fill("0987654321");
  await page.getByRole("button", { name: "Pedir mi correo" }).click();
  await expect(page.locator("#p-error")).toBeVisible();
  await page.getByRole("checkbox", { name: /términos/ }).check();
  await page.getByRole("checkbox", { name: /tratamiento de mis datos/ }).check();
  await page.getByRole("button", { name: "Pedir mi correo" }).click();
  await expect(page.locator("#p-listo")).toContainText("Recibimos su pedido");
  expect(cuerpos.at(-1)).toMatchObject({ accion: "solicitar", plan: "Página web + correo del equipo", dominio: "notaria12cuenca.com", ciudad: "Cuenca",
    notaria: "Notaría 12 de Cuenca", aceptaTerminos: true, aceptaDatos: true });
});

test("si no se puede revisar el dominio, la página lo dice y deja pedirlo igual", async ({ page }) => {
  await page.route("**/api/ventas", (ruta) => ruta.fulfill({ status: 502, json: { error: "x" } }));
  await page.goto("/correo-notarial.html");
  await page.getByLabel("Número de su notaría").fill("3");
  await page.getByLabel("Cantón").fill("Santo Domingo");
  await page.getByRole("button", { name: "Revisar" }).click();
  await expect(page.locator("#b-resultado")).toContainText("No pudimos revisar notaria3santodomingo.com ahora");
  await expect(page.locator("#p-dominio")).toHaveText("Dominio que pide: notaria3santodomingo.com");
});

test("la propuesta enlaza la página de correo", async ({ page }) => {
  await page.goto("/propuesta-sofia.html");
  await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Correo notarial" })).toHaveAttribute("href", "correo-notarial.html");
});

test("@movil la página de correo cabe en el teléfono", async ({ page }) => {
  await page.goto("/correo-notarial.html");
  await page.getByLabel("Número de su notaría").fill("101");
  await page.getByLabel("Cantón").fill("San Miguel de Urcuquí");
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(ancho).toBeLessThanOrEqual(0);
  await expect(page.getByRole("button", { name: "Revisar" })).toBeVisible();
});
