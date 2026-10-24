# Encargo para Codex: revisión y pruebas del commit 5a8c660

Repositorio: `/Users/marquinho/marquinho`, rama `claude/portal-base`. Trabaja en un worktree aparte (`git worktree add ../sofia-codex -b codex/revision 5a8c660`) para no tocar la rama de trabajo.

## Qué hace el commit

- Chat de ventas de SOFIA PreFirma en la página comercial (`api/ventas.js`, `api/_lib/ventas*.js`, `js/ventas-chat.js`).
- Planes con Vitrina (sin mensualidad), solicitud de plan y pago con PagoMedios (`api/_lib/pagos/pagomedios.js`).
- Turnero detrás de la función apagada `turnero` (`api/turnos.js`, `api/_lib/turnos.js`, `turno.html`, `sala.html`, pestaña Fila del panel).
- Elección de modelo por consulta (`api/_lib/modelos.js`): Sonnet 5.5 para lo común, Opus 5.5 para casos complejos o con documentos.

## Tareas, en orden

1. **Revisa la migración `supabase/esquema.sql`** (bloques 2026-10-23, 23b, 23c, 23d). Confirma que cada bloque es SQL válido, que es idempotente y que no toca tablas de la Notaría 41 de forma destructiva. No la ejecutes en Supabase.
2. **Revisa la seguridad de los webhooks:** `api/_lib/pagos/pagomedios.js` (aviso firmado con HMAC propio) y `api/_lib/ventas.js` (`conciliar`). Busca formas de marcar un pago como `pagado` sin que PagoMedios lo confirme, o de cambiar el monto.
3. **Revisa el turnero:** `api/_lib/turnos.js`. Busca condiciones de carrera al llamar turnos y transiciones de estado inválidas. Las pruebas están en `test/turnos.test.js` y `test/revision.test.js`.
4. **Revisa el consentimiento:** cada punto que guarda datos personales debe registrar el consentimiento (`registrarConsentimiento`). Verifica chat, formulario de planes, pago y turnero.
5. **Corre las pruebas:** `npm test` y `npm run test:e2e`. Si algo falla, di qué y por qué, pero no cambies pruebas para que pasen.

## Reglas

- No modifiques precios de los planes sin preguntar: están en `propuesta-sofia.html` y `api/_lib/catalogo-ventas.js`, y deben coincidir (`test/ventas.test.js` lo verifica).
- No cambies textos legales ni sus versiones sin preguntar.
- No hagas commit en `claude/portal-base`. Si haces cambios, déjalos en la rama `codex/revision` y dime qué archivos tocaste.
- Español de Ecuador, trato de tú, en todo lo que quede visible al usuario.

## Entregable

Una lista de hallazgos en orden de gravedad: archivo, línea, riesgo y cómo lo reproduces. Al final, el resultado de `npm test` y `npm run test:e2e`.
