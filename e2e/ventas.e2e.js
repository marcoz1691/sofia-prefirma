import { test, expect } from "./fixtures.js";

// Tablero de prospectos de SOFIA PreFirma con sesión y API simuladas: no se conecta con Supabase.
const base = { cargo: "", correo: "", detalle: "", conversacionId: null, firmadoEn: null, valorMensual: null, proximoPaso: "", proximoEn: null, notas: "", actualizado: null, actualizadoPor: "" };
const prospectos = () => [
  { ...base, id: "1", creado: "2026-11-18T15:00:00Z", nombre: "Ana Pérez", notaria: "Notaría 12", ciudad: "Cuenca", telefono: "0991234567", plan: "Esencial", motivo: "contratar", etapa: "propuesta", contrato: "enviado", pago: "pendiente", detalle: "Quiere empezar en diciembre" },
  { ...base, id: "2", creado: "2026-11-17T15:00:00Z", nombre: "Bruno Vega", notaria: "Notaría 3", ciudad: "Loja", correo: "bruno@notaria3.ec", plan: "", motivo: "cotizacion", etapa: "nuevo", contrato: "no_enviado", pago: "pendiente", proximoEn: "2026-01-05" }
];

async function abrir(page) {
  const lista = prospectos(), cambios = [];
  await page.route("**/vendor/supabase-js-*.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:"simulado"}}}),signOut:async()=>({})}})};' }));
  await page.route("**/api/prospectos**", async (r) => {
    const url = new URL(r.request().url());
    if (url.searchParams.get("accion") === "config") return r.fulfill({ json: { supabaseUrl: "https://ejemplo.supabase.co", supabaseAnonKey: "publica", mfa: false } });
    if (r.request().method() === "GET") return r.fulfill({ json: { prospectos: lista, planes: [{ nombre: "Esencial", mensual: 99 }, { nombre: "Pro", mensual: 199 }], email: "ventas@sofia.ec" } });
    const b = r.request().postDataJSON();
    cambios.push(b);
    const p = lista.find((x) => x.id === b.id);
    Object.assign(p, b.cambios, b.cambios.contrato === "firmado" ? { etapa: "ganado", firmadoEn: "2026-11-19" } : {}, { actualizadoPor: "ventas@sofia.ec" });
    await r.fulfill({ json: { prospecto: p } });
  });
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  await page.goto("/ventas/");
  await expect(page.locator("#tablero")).toBeVisible();
  return { cambios, errores };
}

test("muestra el resumen y marca un contrato como firmado sin recargar", async ({ page }) => {
  const { cambios, errores } = await abrir(page);
  const kpi = (t) => page.locator(".kpi", { hasText: t }).locator("strong");
  await expect(kpi("Contrato enviado")).toHaveText("1");
  await expect(kpi("Contratos firmados")).toHaveText("0");
  await expect(page.locator("#filas .fila")).toHaveCount(2);
  await expect(page.locator(".fila", { hasText: "Bruno Vega" })).toHaveClass(/es-vencido/);

  await page.getByLabel("Contrato de Ana Pérez").selectOption("firmado");
  await expect(page.locator("#aviso")).toHaveText("Contrato firmado: prospecto ganado");
  expect(cambios).toEqual([{ accion: "actualizar", id: "1", cambios: { contrato: "firmado" } }]);
  await expect(page.getByLabel("Etapa de Ana Pérez")).toHaveValue("ganado");
  await expect(page.getByLabel("Fecha de firma de Ana Pérez")).toHaveValue("2026-11-19");
  await expect(kpi("Contratos firmados")).toHaveText("1");
  await expect(kpi("Ingreso mensual firmado")).toContainText("99");
  expect(errores).toEqual([]);
});

test("filtra por etapa, contrato y búsqueda", async ({ page }) => {
  await abrir(page);
  await page.locator("#etapas").getByRole("button", { name: /Nuevo/ }).click();
  await expect(page.locator("#filas .fila")).toHaveCount(1);
  await expect(page.locator("#filas")).toContainText("Bruno Vega");
  await page.locator("#etapas").getByRole("button", { name: /Todas/ }).click();
  await page.locator(".kpi", { hasText: "Contrato enviado" }).click();
  await expect(page.locator("#filas .fila")).toHaveCount(1);
  await expect(page.locator("#filas")).toContainText("Ana Pérez");
  await page.locator(".kpi", { hasText: "Contrato enviado" }).click();
  await page.getByPlaceholder(/Buscar por nombre/).fill("loja");
  await expect(page.locator("#filas .fila")).toHaveCount(1);
  await expect(page.locator("#filas")).toContainText("Bruno Vega");
  await page.getByPlaceholder(/Buscar por nombre/).fill("nadie");
  await expect(page.locator("#vacio")).toBeVisible();
});

// Cliente de Supabase simulado para el acceso: anota en window.llamadas lo que pide la página.
const clienteAcceso = (sesion) => `window.llamadas=[];window.supabase={createClient:()=>({auth:{
  getSession:async()=>({data:{session:${sesion ? '{access_token:"simulado",user:{email:"caro@ejemplo.ec"}}' : "null"}}}),
  resetPasswordForEmail:async(email,o)=>{llamadas.push(["recuperar",email,o.redirectTo]);return{error:null}},
  updateUser:async(d)=>{llamadas.push(["clave",d.password]);return{error:null}},
  mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:"aal1",nextLevel:"aal1"}})}}})};`;

async function rutasAcceso(page, sesion) {
  await page.route("**/vendor/supabase-js-*.js", (r) => r.fulfill({ contentType: "text/javascript", body: clienteAcceso(sesion) }));
  await page.route("**/api/prospectos**", (r) => new URL(r.request().url()).searchParams.get("accion") === "config"
    ? r.fulfill({ json: { supabaseUrl: "https://ejemplo.supabase.co", supabaseAnonKey: "publica", mfa: false } })
    : r.fulfill({ json: { prospectos: prospectos(), planes: [], email: "caro@ejemplo.ec" } }));
}

test("pide el enlace para recuperar la contraseña hacia el propio tablero", async ({ page }) => {
  await rutasAcceso(page, false);
  await page.goto("/ventas/");
  await page.locator("#email").fill("caro@ejemplo.ec");
  await page.getByRole("button", { name: "¿Olvidaste tu contraseña?" }).click();
  await expect(page.locator("#emailRec")).toHaveValue("caro@ejemplo.ec");
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.locator("#vEnviado")).toContainText("caro@ejemplo.ec");
  expect(await page.evaluate(() => window.llamadas)).toEqual([["recuperar", "caro@ejemplo.ec", "http://localhost:" + new URL(page.url()).port + "/ventas/"]]);
});

test("el enlace del correo deja crear la contraseña y entra al tablero", async ({ page }) => {
  await rutasAcceso(page, true);
  await page.goto("/ventas/#access_token=simulado&type=recovery");
  await expect(page.locator("#vDefinir")).toBeVisible();
  await expect(page.locator("#cuentaDefinir")).toHaveText("caro@ejemplo.ec");
  await page.getByLabel("Nueva contraseña").fill("corta");
  await page.getByLabel("Repítela").fill("corta");
  await page.getByRole("button", { name: "Guardar y entrar" }).click();
  await expect(page.locator("#mDefinir")).toContainText("8 caracteres");
  await page.getByLabel("Nueva contraseña").fill("Segura-2026");
  await page.getByLabel("Repítela").fill("Segura-2026");
  await page.getByRole("button", { name: "Guardar y entrar" }).click();
  await expect(page.locator("#tablero")).toBeVisible();
  expect(page.url()).not.toContain("access_token");
  expect(await page.evaluate(() => window.llamadas)).toEqual([["clave", "Segura-2026"]]);
});

test("un enlace vencido ofrece pedir otro", async ({ page }) => {
  await rutasAcceso(page, false);
  await page.goto("/ventas/#error=access_denied&error_code=otp_expired");
  await expect(page.locator("#vVencido")).toBeVisible();
  await page.getByRole("button", { name: "Pedir otro enlace" }).click();
  await expect(page.locator("#vRecuperar")).toBeVisible();
});

test("guarda notas internas y el próximo paso", async ({ page }) => {
  const { cambios } = await abrir(page);
  await page.getByLabel("Próximo paso con Bruno Vega").fill("Enviar propuesta");
  await page.getByLabel("Próximo paso con Bruno Vega").press("Enter");
  await expect.poll(() => cambios.length).toBe(1);
  expect(cambios[0].cambios).toEqual({ proximoPaso: "Enviar propuesta" });
  await page.locator(".fila", { hasText: "Bruno Vega" }).getByRole("button", { name: "Notas" }).click();
  await page.locator('[data-detalle="2"] textarea').fill("Llamó el martes");
  await page.locator('[data-detalle="2"] textarea').blur();
  await expect.poll(() => cambios.length).toBe(2);
  expect(cambios[1].cambios).toEqual({ notas: "Llamó el martes" });
  await expect(page.locator('[data-detalle="2"]')).toBeVisible();
});
