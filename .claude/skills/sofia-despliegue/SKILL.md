---
name: sofia-despliegue
description: Checklist de despliegue de Sofía PreFirma a Vercel y Supabase. Úsalo cuando el usuario hable de desplegar, publicar, subir a producción, ejecutar bloques SQL de supabase/esquema.sql, textos legales, chat de ventas, pagos con PagoMedios, turnero o fila virtual, o plantillas de WhatsApp.
allowed-tools: Read, Grep, Glob, Bash
---

# Despliegue de Sofía PreFirma

Antes de cualquier despliegue: `npm test` y `npm run test:e2e` deben pasar. Los secretos nunca van en el repo.

## 1. Bloques SQL (supabase/esquema.sql)

Cada función nueva exige ejecutar su bloque en Supabase **antes** de desplegar el código. Busca el bloque por su título en `supabase/esquema.sql`:

| Función | Bloque |
|---|---|
| Interruptores y métricas del piloto | «2026-10-11: métricas agregadas del piloto» |
| Pestaña Equipo (rol notario) | «2026-10-11: perfil notario» |
| Consentimientos legales | «2026-10-16: historial de consentimientos» |
| Chat de ventas | «2026-10-23: chat de ventas de SOFIA PreFirma» |
| Pagos PagoMedios | «2026-10-23b» |
| Turnero | «2026-10-23c» |

Confirma con el usuario cuáles ya ejecutó; no asumas.

## 2. Reglas por función

- **Equipo:** admin gestiona todos los perfiles; notario solo invita/da de baja a Personal. Permitir la URL `…/panel/` en Authentication → URL Configuration. La primera cuenta admin se configura en Supabase (README).
- **Textos legales:** `privacidad.html`, `terminos.html`, `cookies.html`, `reembolsos.html`. Sube la versión en `js/legal.js` al cambiar un texto. Formularios y chat piden dos casillas separadas (términos y datos). Pendientes: `docs/legal/cumplimiento.md`.
- **Chat de ventas** (`/api/ventas`, tenant `sofia-ventas`): textos `prefirma-privacidad.html` y `prefirma-terminos.html`. Los precios de `api/_lib/catalogo-ventas.js` deben coincidir con `propuesta-sofia.html`. Guía: `docs/despliegue-sofia-prefirma.md`.
- **Turnero:** viene apagado. Enciende «Turnos en la notaría» en Funciones solo después del bloque 2026-10-23c. WhatsApp usa la plantilla `turno_llamado` (variables: número y ventanilla; nombre configurable con `TURNO_PLANTILLA`), que debe estar aprobada en Meta.

## 3. Verificación de proyecto Vercel

`npm run vercel:verificar:comercial` o `npm run vercel:verificar:piloto` según el sitio. El comercial es `sofiaprefirma`; el piloto es `notaria41`.

Reporta qué pasos están hechos y cuáles faltan; no ejecutes SQL ni despliegues sin confirmación.
