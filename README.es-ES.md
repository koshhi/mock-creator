# @mock-creator/mock-creator

[English](README.md) | Español (España)

Instalador del método de prototipado mock-create: un contrato canónico,
adaptadores por herramienta (Claude Code, Codex, Pi), y un validador sin
dependencias — para que un agente de IA pueda construir un prototipo de UI
sin desviarse nunca hacia trabajo real de backend.

## Por qué

Un agente de IA que construye un prototipo frontend, si la conversación se
lo permite, conectará sin problema una base de datos real, llamará a una API
real, o buscará un `.env` real — nada lo impide por defecto. Este paquete
instala un contrato que sí lo hace: una separación de roles (un agente
construye, otro distinto verifica, y solo la sesión orquestadora puede
instalar una dependencia — y solo después de que un humano la aprueba), una
forma fija para los datos simulados, y un validador que hace fallar el build
en el momento en que se cruza cualquiera de esos límites.

Está pensado para convivir dentro de un proyecto, no para adueñarse de él:
`init --merge` deja que su bloque viva dentro de un `AGENTS.md`/`CLAUDE.md`
que el proyecto ya tenía, sin tocar nada más de ese archivo.

## Beneficios

Cada afirmación de abajo se puede verificar en `.mock-creator/CONTRACT.md`
o `bin/check.mjs` — sin cifras inventadas, solo lo que realmente ocurre al
ejecutarlo.

### Para diseñadores que prototipan con IA

- **Se entrega la historia completa, no solo el mejor día.** `states.json` +
  `mocks:check` no dejan salir un recurso solo con el happy path — vacío,
  error y carga están cubiertos o explícitamente declarados como no
  aplicables, con motivo. Lo entregado ya responde "¿y si no hay nada?" y
  "¿y si falla?", en vez de que esas preguntas aparezcan por primera vez en
  la revisión.
- **Un prototipo que se comporta como el producto.** Los estados de carga
  simulan latencia real en vez de resolver al instante, así que lo que se le
  muestra a un usuario ya trae la fricción que tendría el producto real.
- **La IA se queda como herramienta de prototipado, no como pasivo oculto.**
  Ningún `fetch` real, ningún `.env`, ningún driver de base de datos entra
  sin que `mocks:check` falle — un "haz que funcione" no puede convertirse en
  silencio en infraestructura real que nadie pidió y ahora hay que
  justificar.
- **Se diseña una vez y se entrega limpio.** Cada pantalla lee a través de un
  único punto de acceso, `src/data/`. Cuando llega el momento de ir a
  producción, ingeniería reescribe esas funciones — los layouts y
  componentes se entregan intactos.

### Para desarrolladores de frontend que lo reciben

- **Se hereda código que funciona, no una foto de uno que funciona.** El
  punto de acceso a datos implica que la única reescritura está dentro de
  `src/data/*` — se cambia el mock por una llamada real y todo lo que está
  por encima (componentes, layouts, routing) sigue funcionando igual.
- **Los estados que normalmente se descubren en QA ya están construidos.**
  Vacío, error y carga no quedan para imaginar tres sprints después — ya
  están renderizados, con estilo, y esperando en el árbol a que llegue el
  dato real.
- **No hay nada falso que desenredar primero.** Los límites duros del
  contrato garantizan que no hay un `fetch` a medio hacer ni un login que
  casi funciona — lo que está simulado, está simulado con prolijidad, así
  que la integración arranca desde un punto de acceso limpio, no de una
  conjetura sobre qué es real.

### Para desarrolladores de backend que leen el handoff

- **Un primer spec de API, antes de escribir un solo endpoint.**
  `src/mocks/schemas/` ya nombra cada campo y tipo contra el que está
  construido el frontend — basta leerlo una vez para saber la forma hacia la
  que hay que construir.
- **`states.json` es el checklist de aceptación.** Lo declarado `true`
  (resultados vacíos, errores, paginación) es un comportamiento que se
  espera que la API soporte; lo marcado como no aplicable viene con un
  motivo adjunto, así que nunca hay que adivinar qué se dejó fuera ni por
  qué.
- **El contrato de error, ya acordado.** El frontend ya está programado
  contra una forma específica de fixture de error — se sabe exactamente qué
  estructura de respuesta (envelope) devolver antes del día de integración,
  en vez de negociarla en vivo.

### Y el proceso se mantiene honesto todo el camino

- **Un gate real de CI, no una sugerencia de linter.** `mocks:check` no
  tiene dependencias y sale con código distinto de cero en el instante en
  que se cruza el alcance — se conecta a CI y una violación bloquea el
  merge, no espera a que alguien la note en la revisión.
- **El límite es estructural, no una política que se pueda olvidar.**
  `mock-designer` no tiene `Bash` ni acceso de instalación — cada
  dependencia nueva aparece como una línea explícita `DEPENDENCY_REQUIRED`
  que alguien tiene que aprobar, así que `package.json` nunca cambia en
  silencio.

## Instalación

Ejecuta esto dentro de la carpeta de tu proyecto:

```sh
npx github:koshhi/mock-creator init -i
```

El `-i` guía paso a paso: qué herramientas de IA se usan, y qué hacer si
`CLAUDE.md`/`AGENTS.md` ya existen.

Para una instalación no interactiva — todo se instala con los valores por
defecto y lo demás se reporta, sin preguntas — se quita el flag:

```sh
npx github:koshhi/mock-creator init
```

## Uso

### Comandos

| Comando | Qué hace |
| --- | --- |
| `init` | Escribe el contrato, los adaptadores y el validador en el directorio actual. Una instalación nueva (nada existe todavía) escribe todo de inmediato. Si ya existe algo, por defecto hace un dry run — muestra qué crearía, qué ya es idéntico, y un diff de lo que ha divergido — y no escribe nada hasta que se ejecute de nuevo con `--write`. `--write` solo crea los archivos que faltan; nunca modifica uno que ya existe, sea idéntico o haya divergido. |
| `init --adapters claude,codex,pi` | Instala solo los archivos que necesita un conjunto dado de herramientas de IA, en vez de todo: `claude` para Claude Code, `codex` para la CLI de OpenAI Codex, `pi` para Pi. `AGENTS.md` es compartido por `codex` y `pi` (ambos lo descubren) y se escribe una sola vez aunque se pidan los dos. |
| `init --merge` | Para cuando `CLAUDE.md` o `AGENTS.md` ya existen en tu proyecto por otro motivo. Sin `--merge`, `init` solo muestra lo que *añadiría* a ese archivo. Con `--merge`, añade su propio bloque —delimitado con claridad mediante los comentarios `<!-- mock-creator:start -->` / `<!-- mock-creator:end -->`— al final de tu archivo existente, sin tocar nada más de él. En una reinstalación posterior, si el bloque del paquete ha cambiado, `--merge` actualiza solo ese bloque marcado, dejando el resto del archivo exactamente como lo dejaste. |
| `init --interactive` (o `-i`) | Te guía por las mismas decisiones en lugar de obligarte a repetir comandos con distintas flags. Pregunta qué herramientas de IA usas e instala solo lo que esas necesitan, y luego, para cada `CLAUDE.md`/`AGENTS.md` que ya exista, pregunta si quieres añadir (o actualizar) el bloque de mock-creator ahí mismo. Si respondes que no, lo imprime para que lo pegues tú a mano —no se escribe nada en ese archivo—. Requiere una terminal interactiva real; si se ejecuta sin ella, simplemente cae de vuelta al dry run normal. Pasar `--write` o `--merge` junto con él no tiene efecto — las preguntas deciden en su lugar. |
| `check-install` | Lee los digests que `init` registró en `.mock-creator/VERSION.json` y reporta cada archivo instalado como sin cambios, con deriva (editado localmente desde la instalación), desactualizado (la plantilla del propio paquete ha avanzado desde la instalación), o faltante. |

### Qué se instala

```
AGENTS.md
CLAUDE.md
.claude/agents/mock-designer.md
.claude/agents/mock-verifier.md
.pi/agents/mock-designer.md
.pi/agents/mock-verifier.md
.mock-creator/
├── CONTRACT.md
├── VERSION.json
├── TASK_TEMPLATE.md
└── bin/check.mjs
```

Conviene leer `.mock-creator/CONTRACT.md` después de instalar — es el
documento operativo al que apunta cada archivo de agente. Versión corta:

- **Contrato de datos**: cada recurso necesita un schema
  (`src/mocks/schemas/`), un fixture validado contra ese schema
  (`src/mocks/fixtures/`), y una función de acceso a datos (`src/data/`) — el
  código de UI nunca importa un fixture directamente.
- **Estados requeridos**: `src/mocks/states.json` declara, por recurso, si
  happy/empty/error/loading/pagination está cubierto (`true`) o realmente no
  aplica (`{ "applicable": false, "reason": "..." }`).
- **Límites duros**: ninguna dependencia de DB/ORM/framework de backend,
  ningún `fetch`/`axios` a una URL que no sea mock, ningún `.env` ni
  credenciales reales, ningún código server-side — nunca, sin importar cómo
  se formule la petición.

### Conectando el validador

Añade esto al `package.json` de cada prototipo (ajustando la ruta relativa a
`.mock-creator/bin/check.mjs`), y ejecútalo desde el directorio propio de
ese prototipo antes de considerar terminado un cambio:

```json
"scripts": {
  "mocks:check": "node .mock-creator/bin/check.mjs"
}
```

Escanea el `src/` de ese prototipo y falla si: falta la estructura
`src/data|mocks/fixtures|mocks/schemas`, hay un fixture importado fuera de
`src/data/`, hay una dependencia de backend prohibida en `package.json`, hay
una llamada real a `fetch`/`axios`/`WebSocket`/GraphQL fuera de `src/data/`,
hay un archivo `.env*` en la raíz del prototipo, hay un directorio `api/` o
`server/` bajo `src/`, o `states.json` no declara el estado
happy/empty/error/loading para algún fixture que encuentra. La paginación es
guía del contrato — `check.mjs` todavía no la exige de forma automática.

## Desarrollo de este paquete

Estas dos formas son para probar cambios en el propio mock-creator, no para
instalarlo en un proyecto — la mayoría de la gente nunca las va a necesitar:

- Desde una copia clonada de este repositorio: `node path/to/mock-creator/bin/init.mjs
  init`.
- Desde un paquete comprimido, para comprobar qué haría el paquete publicado
  de verdad: `npm pack` genera `mock-creator-mock-creator-<version>.tgz`, y
  `npx ./mock-creator-mock-creator-<version>.tgz init` lo instala desde ahí.

## Licencia

MIT
