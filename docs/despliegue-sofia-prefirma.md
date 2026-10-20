# Sofía PreFirma y Notaría 41 son proyectos distintos

El plan completo de implementación, seguridad, pruebas y rollout está en [plan-piloto-notaria41.md](plan-piloto-notaria41.md).

El producto se llama **Sofía PreFirma**. La Notaría 41 de Quito es su primer piloto. Comparten el código mientras se valida el producto, pero no comparten el destino público:

| Proyecto Vercel | Dominio | Función |
|---|---|---|
| `sofiaprefirma` | `sofiaprefirma.com` | Presentación comercial de la plataforma |
| `sofiaprefirma-notaria41` | `notaria41.sofiaprefirma.com` | Aplicación aislada del primer piloto |
| `notaria41` | dominio y URL propios de la notaría | Sitio institucional de la Notaría 41 |

## Regla de despliegue

- Las funciones nuevas del portal se prueban y se despliegan primero en `sofiaprefirma`.
- No se despliegan automáticamente en `notaria41` durante el piloto.
- `NOTARIA_ID=notaria41` identifica al piloto dentro del proyecto de Sofía. Cuando una segunda notaría esté lista, tendrá su identificador y dominio propios.
- Los interruptores `portal` y `pagosEnLinea` nacen apagados. El primero se enciende después de configurar correo y base; el segundo solo después de integrar una pasarela real.
- Antes de desplegar, ejecuta `npm run vercel:verificar:comercial` o `npm run vercel:verificar:piloto` dentro del checkout aislado correspondiente. La comprobación exige tanto el nombre como el `projectId` exactos y bloquea el proyecto institucional.
- Durante la preparación, la verificación del piloto también exige que el `vercel.json` de ese checkout no contenga cron jobs. Se restauran únicamente después de G1 y del corte documentado del backend operativo.
- El proyecto comercial está conectado al repositorio `marcoz1691/sofia-prefirma`, rama `main`. El piloto se despliega manualmente desde un staging verificado y no se conecta todavía a Git para impedir que un push restaure cron jobs por accidente.
- No despliegues desde el checkout principal: actualmente su vínculo local pertenece a `notaria41`.

## Antes de habilitar el portal

1. Los bloques del **2026-10-18** y **2026-10-19** de `supabase/esquema.sql` se aplicaron el 19 de octubre de 2026, cada uno después de crear un respaldo verificable. El segundo es expansivo y mantiene compatibilidad temporal con el backend institucional anterior.
2. En `sofiaprefirma-notaria41` ya están configurados Supabase, `NOTARIA_ID`, `CUENTA_SECRETO`, `SITIO_URL`, retención y MFA. Faltan `RESEND_API_KEY` y `CORREO_REMITENTE`.
3. Verificar `sofiaprefirma.com` en el proveedor de correo.
4. Probar código de acceso, cierre de sesión, vínculo de una cita, aislamiento entre clientes y carga de documentos.
5. Activar `portal` desde el panel. No activar `pagosEnLinea` sin proveedor real.

## Dominio del piloto

El destino recomendado para el portal de la primera notaría es `notaria41.sofiaprefirma.com`. El servidor obtiene `notaria41` de ese subdominio; el navegador no puede escoger otra notaría mediante un parámetro.

## Estado verificado y reversión

- Producción comercial validada: deployment `dpl_6VhdaVfgNCZ2DZeL8wE4vnaRcb8N`.
- Piloto aislado de preparación: deployment `dpl_47b9yRbJmdHKAzGxRb417EQ5scr6`, publicado el 2026-10-20 desde el commit `ff4acbe`; permanece protegido en modo Vercel Authentication `all` y sin dominio personalizado. El alias estable `sofiaprefirma-notaria41.vercel.app` apunta a esta versión. Tiene Supabase, `NOTARIA_ID=notaria41`, secreto de cuenta, retención y MFA.
- La verificación posterior al despliegue confirmó portada autenticada `200`, acceso público redirigido al inicio de sesión de Vercel, precios aislados de `notaria41` y `/api/cuenta` cerrado con `503` porque `portal=0`.
- El deployment de preparación se publicó sin definiciones de cron. `portal`, `documentos` y `pagosEnLinea` están fijados en `0`; no se restauran cron jobs hasta configurar `CRON_SECRET` y ejecutar el corte del único backend operativo.
- Supabase Auth permite las URLs del panel piloto sin reemplazar la URL principal del panel institucional.
- El respaldo inmediatamente anterior al aislamiento multitenant está en `~/Documents/Respaldos-Sofia-Prefirma/2026-10-19-pre-multitenant/`; sus dos archivos tienen permisos `600` y hashes SHA-256 verificados.
- La migración multitenant quedó verificada con 12 tablas tenantizadas, 7 llaves foráneas compuestas y las dos firmas —nueva y compatible— de las funciones de métricas y límites. El bloque `2026-10-19b` retiró las FK simples redundantes para que PostgREST tenga una sola relación posible por embed.
- La contraseña de base debe rotarse antes de abrir el piloto porque apareció en la salida local de una comprobación de respaldo; después hay que actualizar `.env.local` y cualquier variable que la use.
- Antes de promover otra versión, conserva el ID del deployment que atiende cada dominio.
- Para volver a la versión anterior del piloto, usa `vercel promote dpl_4kdYCZ2MPcYMy8DuCSEjzgiH9SpV --yes` desde un checkout que haya pasado `npm run vercel:verificar:piloto` y que no contenga cron jobs.
- Para volver a la versión comercial validada, usa `vercel promote dpl_6VhdaVfgNCZ2DZeL8wE4vnaRcb8N --yes` desde un checkout que haya pasado `npm run vercel:verificar:comercial`.
- No promociones el deployment del piloto ni le asignes `notaria41.sofiaprefirma.com` hasta completar las variables, migraciones y puertas G1–G2 del plan maestro.
