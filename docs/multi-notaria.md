# Preparación para varias notarías

Hoy la plataforma tiene una sola notaría operativa (`notaria41`) como piloto. Este documento fija cómo se aísla cada notaría y qué falta para atender a varias, sin prometer una autoconfiguración que todavía no existe.

## Modelo de aislamiento

- La tabla `notarias` lista las notarías. Su `id` es un texto corto (`notaria41`).
- **La notaría la decide el servidor** a partir de `NOTARIA_ID` en un proyecto dedicado o del subdominio `*.sofiaprefirma.com` (`api/_lib/notaria.js`, `notariaDe`). Nunca se acepta desde el cuerpo ni desde parámetros del navegador.
- RLS está activado en todas las tablas y no hay políticas: nadie con la clave pública puede leer ni escribir. El servidor usa `service_role`, que se salta RLS, así que **el aislamiento lo exige el código**: cada método del almacén del portal llama a `exigirNotaria` y filtra por `notaria_id` (y por `cliente_id` en todo lo del cliente). Lo ajeno responde 404, igual que lo inexistente.
- El almacén del núcleo queda fijado a una notaría al arrancar. Conversaciones, panel, citas, documentos, precios, ajustes, métricas, auditoría, límites y retención filtran por ese `notaria_id`.
- Pruebas de acceso cruzado: `test/portal-almacen.contrato.test.js`, `test/almacen-supabase-tenant.test.js`, `test/cuenta-http.test.js` y `test/pagos-http.test.js`.

## Inventario de tablas

| Situación | Tablas |
|---|---|
| Tienen `notaria_id` | `conversaciones`, `sesiones`, `mensajes`, `pendientes`, `archivos`, `documentos`, `solicitudes_cita`, `personal`, `clientes`, `cliente_codigos`, `cliente_sesiones`, `tramite_vinculaciones`, `tramite_eventos`, `pagos`, `precios`, `ajustes`, `metricas_dia`, `auditoria`, `uso`, `consentimientos`, `procesados` |
| La heredan por su pago | `pago_eventos` |

La migración expansiva del 19 de octubre de 2026 conserva temporalmente el valor predeterminado `notaria41` y las funciones SQL antiguas de métricas y límites. Esto permite que el backend institucional anterior siga funcionando mientras comparte la base. Esos puentes se retiran únicamente después de actualizar y verificar ambos despliegues.

## Lo que falta para la segunda notaría

1. Un proyecto o configuración de ejecución fijado con `NOTARIA_ID`; no abrir hosts desconocidos ni previews sin tenant explícito.
2. Un número de WhatsApp, una fuente de contenido, secretos y remitente de correo por notaría.
3. Personalización de marca y catálogo sin editar archivos compartidos.
4. Pruebas integradas contra una base de ensayo con dos notarías antes de ingresar datos reales de la segunda.
5. Retirar los defaults y funciones SQL de compatibilidad de `notaria41` después del corte del backend anterior.
6. Crear el registro DNS y agregar a Vercel cada subdominio.

## Personalización futura (no disponible todavía)

Una tabla `notaria_marca` con logotipo, colores, dominio, horarios, contactos, catálogo, canales y configuración de pagos. La cargará el equipo de Sofía PreFirma; no habrá autoconfiguración hasta que exista y esté probada.

## Pagos de la notaría por su plan (caso B)

Separados por completo de los pagos de trámites: tablas `suscripciones` y `suscripcion_pagos`, con su propio webhook y sus propios comprobantes. Todavía no se construyen.
