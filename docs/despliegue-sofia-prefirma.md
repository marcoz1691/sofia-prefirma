# Sofía PreFirma y Notaría 41 son proyectos distintos

El plan completo de implementación, seguridad, pruebas y rollout está en [plan-piloto-notaria41.md](plan-piloto-notaria41.md).

El producto se llama **Sofía PreFirma**. La Notaría 41 de Quito es su primer piloto. Comparten el código mientras se valida el producto, pero no comparten el destino público:

| Proyecto Vercel | Dominio | Función |
|---|---|---|
| `sofiaprefirma` | `sofiaprefirma.com` | Presentación comercial de la plataforma |
| `sofiaprefirma-notaria41` | `notaria41.sofiaprefirma.com` | Aplicación aislada del primer piloto |
| `notaria41` | dominio y URL propios de la notaría | Sitio institucional de la Notaría 41 |

## Regla de despliegue

- Las funciones nuevas del portal se prueban en un preview y se despliegan en `sofiaprefirma-notaria41`; el proyecto `sofiaprefirma` conserva la presentación comercial.
- No se despliegan automáticamente en `notaria41` durante el piloto.
- `NOTARIA_ID=notaria41` identifica al piloto dentro del proyecto de Sofía. Cuando una segunda notaría esté lista, tendrá su identificador y dominio propios.
- Los interruptores `portal` y `pagosEnLinea` nacen apagados. El primero se enciende después de configurar correo y base; el segundo solo después de integrar una pasarela real.
- Antes de desplegar, ejecuta `npm run vercel:verificar:comercial` o `npm run vercel:verificar:piloto` dentro del checkout aislado correspondiente. La comprobación exige tanto el nombre como el `projectId` exactos y bloquea el proyecto institucional.
- Durante la preparación, la verificación del piloto también exige que el `vercel.json` de ese checkout no contenga cron jobs. Se restauran únicamente después de G1 y del corte documentado del backend operativo.
- El proyecto comercial está conectado al repositorio `marcoz1691/sofia-prefirma`, rama `main`. El piloto se despliega manualmente desde un staging verificado y no se conecta todavía a Git para impedir que un push restaure cron jobs por accidente.
- No despliegues desde el checkout principal: actualmente su vínculo local pertenece a `notaria41`.

## Antes de habilitar el portal

1. Los bloques del **2026-10-18** y **2026-10-19** de `supabase/esquema.sql` se aplicaron el 19 de octubre de 2026. El bloque aditivo de cuarentena documental del **2026-10-20** también está aplicado. Cada cambio se ejecutó después de crear un respaldo verificable; el aislamiento multinotaría mantiene compatibilidad temporal con el backend institucional anterior.
2. En `sofiaprefirma-notaria41` ya están configurados Supabase, `NOTARIA_ID`, `CUENTA_SECRETO`, `HUELLA_IP_SECRETO`, `SITIO_URL`, retención y MFA. Faltan `RESEND_API_KEY` y `CORREO_REMITENTE`.
3. Verificar `sofiaprefirma.com` en el proveedor de correo.
4. Probar código de acceso, cierre de sesión, vínculo de una cita y aislamiento entre clientes. Mantener `documentos=0` hasta integrar el escáner real; las pruebas actuales de cuarentena no autorizan documentos reales.
5. Activar `portal` desde el panel. No activar `pagosEnLinea` sin proveedor real.

## Dominio del piloto

El destino recomendado para el portal de la primera notaría es `notaria41.sofiaprefirma.com`. Durante el piloto, el proyecto queda fijado en servidor con `NOTARIA_ID=notaria41`; el navegador no puede escoger otra notaría mediante un parámetro. La relación dinámica dominio→tenant pertenece a la Fase 6.

## Cierre y publicación del siguiente lote

No uses el checkout principal: su `.vercel/project.json` apunta al proyecto institucional `notaria41`. El orden operativo es:

1. En la rama de trabajo, ejecutar `npm test`, `npm run test:e2e` y `npm audit --omit=dev --audit-level=high`. Registrar el SHA solo después de que las tres comprobaciones terminen correctamente.
2. Revisar `git status --short`, `git diff --check` y el diff preparado. No añadir `.shots.mjs`, `.env.local`, `inmobiliaria/` ni artefactos locales.
3. Subir `claude/portal-base`, abrir el pull request con `gh pr create --repo marcoz1691/sofia-prefirma --base main --head claude/portal-base --fill` y esperar CI con `gh pr checks --repo marcoz1691/sofia-prefirma --watch`. Esto requiere ejecutar antes `gh auth login`; actualmente GitHub CLI no tiene una sesión autenticada.
4. Crear un checkout aislado del SHA aprobado. Preparar allí un archivo local de configuración equivalente a `vercel.json`, pero sin la propiedad `crons`; no modificar el archivo versionado ni restaurar crones durante esta etapa.
5. Vincular exclusivamente ese checkout con `npx vercel@65.0.0 link --yes --project sofiaprefirma-notaria41` y confirmar el destino con `npm run vercel:verificar:piloto -- <config-piloto-sin-crons.json>`.
6. Crear un preview con `npx vercel@65.0.0 deploy --yes --local-config <config-piloto-sin-crons.json>`. Inspeccionarlo con `npx vercel@65.0.0 inspect <deployment-url>` y probar las rutas protegidas con `npx vercel@65.0.0 curl / --deployment <deployment-url>` y `npx vercel@65.0.0 curl /api/precios --deployment <deployment-url>`.
7. Confirmar que el acceso público continúa protegido, que `/api/cuenta` responde `503`, que el tenant es `notaria41` y que los tres interruptores continúan en `0`. Revisar errores con `npx vercel@65.0.0 logs --deployment <deployment-url> --query 'level:error' --limit 50`.
8. Solo si todo lo anterior pasa, promover con `npx vercel@65.0.0 promote <deployment-url> --yes` y registrar el nuevo deployment y el anterior para reversión. No asociar todavía el dominio personalizado.

`<config-piloto-sin-crons.json>` y `<deployment-url>` son marcadores deliberados: deben sustituirse por el archivo temporal revisado y la URL exacta que devuelve Vercel; no deben copiarse literalmente ni guardarse en Git.

## Estado verificado y reversión

- Producción comercial validada: deployment `dpl_6VhdaVfgNCZ2DZeL8wE4vnaRcb8N`.
- Piloto aislado de preparación: deployment `dpl_4LETv6Vbms3rfitDfDCGP57xFkD1`, publicado el 2026-10-21 desde el commit `bce53a2`; permanece protegido en modo Vercel Authentication `all` y sin dominio personalizado. El alias estable `sofiaprefirma-notaria41.vercel.app` apunta a esta versión. Tiene Supabase, `NOTARIA_ID=notaria41`, secretos independientes de cuenta y huella de IP, retención y MFA.
- La verificación posterior al despliegue confirmó portada autenticada `200`, acceso público redirigido al inicio de sesión de Vercel, precios aislados de `notaria41` y `/api/cuenta` cerrado con `503` porque `portal=0`.
- El deployment de preparación se publicó sin definiciones de cron. `portal`, `documentos` y `pagosEnLinea` están fijados en `0`; no se restauran cron jobs hasta configurar `CRON_SECRET` y ejecutar el corte del único backend operativo.
- Supabase Auth permite las URLs del panel piloto sin reemplazar la URL principal del panel institucional.
- El respaldo inmediatamente anterior al aislamiento multitenant está en `~/Documents/Respaldos-Sofia-Prefirma/2026-10-19-pre-multitenant/`; sus dos archivos tienen permisos `600` y hashes SHA-256 verificados.
- El respaldo anterior a la cuarentena está en `~/Documents/Respaldos-Sofia-Prefirma/2026-10-20-pre-cuarentena/`; el dump y el esquema tienen permisos `600`, el dump fue leído correctamente por `pg_restore` y ambos hashes SHA-256 quedaron verificados localmente.
- La migración multitenant quedó verificada con 12 tablas tenantizadas, 7 llaves foráneas compuestas y las dos firmas —nueva y compatible— de las funciones de métricas y límites. El bloque `2026-10-19b` retiró las FK simples redundantes para que PostgREST tenga una sola relación posible por embed.
- La contraseña de base debe rotarse antes de abrir el piloto porque apareció en la salida local de una comprobación de respaldo; después hay que actualizar `.env.local` y cualquier variable que la use.
- Antes de promover otra versión, conserva el ID del deployment que atiende cada dominio.
- Para volver a la versión anterior del piloto, usa `npx vercel@65.0.0 promote dpl_59bwjg9wTfutDtx1NVsiGPWHQ4Mw --yes` desde un checkout que haya pasado `npm run vercel:verificar:piloto` y que no contenga cron jobs.
- Para volver a la versión comercial validada, usa `vercel promote dpl_6VhdaVfgNCZ2DZeL8wE4vnaRcb8N --yes` desde un checkout que haya pasado `npm run vercel:verificar:comercial`.
- No promociones el deployment del piloto ni le asignes `notaria41.sofiaprefirma.com` hasta completar las variables, migraciones y puertas G1–G2 del plan maestro.
