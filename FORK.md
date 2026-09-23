# Hydra

Hydra es el fork independiente de [Orca](https://github.com/stablyai/orca),
mantenido en [juan-pujante/hydra](https://github.com/juan-pujante/hydra).
Su objetivo es desarrollar mejoras de coordinación multiagente con decisiones
y calendario propios, conservando la posibilidad de integrar mejoras de Orca.

## Base y licencia

- Revisión de Orca tomada como base inicial: `519bde81df438478ff1c6ac010f1339f32a306ee`.
- Se conserva el historial Git y la [licencia MIT original](LICENSE).
- Esta preparación añade documentación; todavía no cambia el comportamiento,
  la identidad de la aplicación ni sus servicios externos.
- Los enlaces de descarga del README original corresponden a Orca. Hydra
  todavía no publica instaladores propios.

## Remotos y ramas

- `origin`: `https://github.com/juan-pujante/hydra.git`.
- `upstream`: `https://github.com/stablyai/orca.git`.
- `main`: versión estable de Hydra.
- `feature/<mejora>` y `fix/<problema>`: cambios propios pequeños y revisables.
- `sync/orca-<fecha>`: integración temporal de una actualización del original.

En una nueva copia, clonar `origin` y añadir `upstream`. Configuración local
recomendada (no modifica otros repositorios):

```sh
git remote add upstream https://github.com/stablyai/orca.git
git config remote.pushDefault origin
git config pull.ff only
git config rerere.enabled true
```

`rerere` recuerda resoluciones de conflictos para reutilizarlas; siempre revisar
el resultado. No reescribir la historia publicada de `main` ni hacer force-push
para igualarla a Orca.

## Integrar una actualización de Orca

Empezar con el árbol de trabajo limpio y sustituir `AAAA-MM-DD` por la fecha:

```sh
git switch main
git pull --ff-only origin main
git fetch upstream main --no-tags
git switch -c sync/orca-AAAA-MM-DD
git merge --no-ff upstream/main
```

También se puede integrar un commit concreto ya descargado en lugar de
`upstream/main`. Resolver y revisar los conflictos conservando las decisiones
propias de Hydra. Si se quiere abandonar un merge en conflicto, usar
`git merge --abort`.

Validar la integración siguiendo [CONTRIBUTING.md](.github/CONTRIBUTING.md),
incluyendo lint, tipos, pruebas y compilación, además de las pruebas de las
funcionalidades propias afectadas. Registrar en este documento la revisión de
Orca integrada y los cambios deliberadamente adaptados o revertidos.

Publicar la rama y abrir el PR **en Hydra**, indicando siempre el repositorio
para evitar que GitHub CLI lo dirija al proyecto original:

```sh
git push -u origin sync/orca-AAAA-MM-DD
gh pr create --repo juan-pujante/hydra --base main --head sync/orca-AAAA-MM-DD
```

Usar la plantilla de PR del repositorio. Incorporar las sincronizaciones con
un **merge commit**, no con squash ni rebase: debe conservarse la ascendencia
de Orca para los siguientes merges. Reservar `cherry-pick -x` para arreglos
puntuales y revisar sus dependencias.

## Desarrollo propio

Mantener las mejoras separadas de reformateos y renombrados. Reutilizar los
mecanismos existentes de terminales, worktrees, estado de agentes y ejecución
remota; documentar aquí cualquier cambio de sus contratos. Las contribuciones
al proyecto original se preparan en ramas independientes desde `upstream/main`.

Antes de distribuir Hydra o usarla junto a una instalación de Orca, preparar
un cambio específico de identidad y comprobar:

- Identificadores de aplicación, nombre visible y acceso al llavero.
- Directorios de datos, perfiles, sockets y procesos auxiliares.
- Comando CLI y registro de protocolos/enlaces.
- Actualizaciones, repositorio de releases y firma de instaladores.
- Servicios externos y compatibilidad con hosts remotos y clientes móviles.

No basta con cambiar el nombre de `package.json`. La separación de identidad
requiere validación antes de afirmar que las dos aplicaciones pueden convivir.

## Registro de diferencias

| Cambio | Motivo | Impacto en futuras sincronizaciones |
| --- | --- | --- |
| `FORK.md` | Documentar propiedad, base y mantenimiento de Hydra | Archivo propio; sin cambios al runtime |
