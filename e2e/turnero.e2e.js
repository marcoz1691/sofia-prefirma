import { test, expect } from "@playwright/test";

test("el cliente toma su turno, ve su posición y el aviso cuando lo llaman", async ({ page }) => {
  let estado = { numero: "T-007", estado: "esperando", delante: 2, ventanilla: "", llamandoAhora: { numero: "T-004", ventanilla: "1" } };
  await page.route("**/api/turnos**", async (ruta) => {
    if (ruta.request().method() === "POST") return ruta.fulfill({ json: { codigo: "a".repeat(24), ...estado } });
    return ruta.fulfill({ json: estado });
  });
  await page.goto("/turno.html");
  await page.getByLabel("Tu nombre").fill("Ana Pérez");
  await page.getByRole("checkbox", { name: /términos/ }).check();
  await page.getByRole("checkbox", { name: /tratamiento de mis datos/ }).check();
  await page.getByRole("button", { name: "Tomar mi turno" }).click();
  await expect(page.locator("#ticket-numero")).toHaveText("T-007");
  await expect(page.locator("#ticket-estado")).toHaveText("Tienes 2 personas delante.");
  await expect(page.locator("#ticket-llamando")).toHaveText("Ahora atienden el T-004 en la ventanilla 1.");
  estado = { ...estado, estado: "llamado", delante: 0, ventanilla: "2" };
  await page.reload();
  await expect(page.locator("#ticket-estado")).toHaveText("¡Te toca! Acércate a la ventanilla 2.");
});

test("la pantalla de la sala muestra el número llamado y los anteriores", async ({ page }) => {
  await page.route("**/api/turnos?accion=sala", (ruta) => ruta.fulfill({ json: { llamados: [{ numero: "T-012", ventanilla: "2", actual: true }, { numero: "T-011", ventanilla: "1", actual: false }], esperando: 3 } }));
  await page.goto("/sala.html");
  await expect(page.locator("#sala-numero")).toHaveText("T-012");
  await expect(page.locator("#sala-ventanilla")).toHaveText("Ventanilla 2");
  await expect(page.locator("#sala-lista li")).toHaveCount(1);
  await expect(page.locator("#sala-espera")).toHaveText("3 personas en espera");
});
