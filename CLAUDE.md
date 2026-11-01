@AGENTS.md

## Skills del proyecto

Los procedimientos largos y ocasionales viven en `.claude/skills/`. Para desplegar cambios de base de datos, legales, ventas o turnero usa el skill `sofia-despliegue`.

Subagente: `despliegue-auditor` (solo lectura, carga el skill de despliegue). Los subagentes no heredan skills: se declaran con `skills:` en `.claude/agents/`.
