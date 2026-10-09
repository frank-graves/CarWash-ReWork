# Exclusivo Car Wash

Registro de lavados y clientes para un lavadero local. Privacidad radical: todo el PII se cifra en el dispositivo antes de tocar Firestore, y la clave nunca sale del navegador.

## Stack

- Astro + Preact + Preact Signals
- Firebase Firestore + Firebase Auth (anónima)
- Web Crypto API: AES-GCM 256, PBKDF2 200k iteraciones
- CSS Modules, tokens en `src/styles/tokens.css`
- Vitest + fake-indexeddb
- pnpm, Biome, TypeScript strict

## Cómo correr en dev

```bash
# Terminal A — emuladores (dejar abierta)
pnpm exec firebase emulators:start
# Auth 9099, Firestore 8080, UI 4000

# Terminal B — dev server (dejar abierta)
pnpm dev
# http://localhost:4321/
```

El primer arranque pide crear el negocio (workspace) o unirse a uno con un código de conexión. En dev no hace falta cuenta de Firebase: los emuladores no validan contra el proyecto real.

## Comandos frecuentes

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm build
pnpm exec firebase deploy --only hosting
pnpm exec firebase deploy --only firestore:rules
pnpm exec firebase deploy --only firestore:rules,hosting
```

Para borrar la bóveda local de un dispositivo (consola del navegador, F12):

```js
indexedDB.deleteDatabase('carwash-vault').onsuccess = () => location.reload();
```

## Privacidad

La Master Key se genera aleatoria en cada dispositivo. No se deriva del PIN: el PIN es una cerradura local, no la llave del dato.

Se envuelve dos veces, y las dos envolturas viven en IndexedDB: una con el PIN (`blobPin`) y otra con la frase de recuperación (`blobRec`). Cambiar el PIN re-envuelve esos 32 bytes y nada más; los datos en la nube no se tocan ni se vuelven a subir.

Dentro del sobre viajan dos secretos: la Master Key, que cifra el PII, y la clave HMAC, que firma las huellas de matrícula. Como la búsqueda por placa se hace sobre el HMAC, sin la bóveda abierta ni siquiera se puede consultar si un cliente existe.

Borrar IndexedDB sella los datos de la nube para siempre, para el operador y también para el equipo de desarrollo.

## Roles

| Rol | Puede |
|---|---|
| owner | Todo. Reparte ownership, genera invites de admin o staff. |
| admin | Genera invites de staff, no puede crear más admins. No toca precios, lavadores ni el PIN del dispositivo. |
| staff | Registra lavados y consulta clientes. Sin Ajustes. |

## Enrollment por código

1. Owner/admin abre Ajustes → Equipo → Generar código de conexión.
2. Elige rol (admin o staff) y el dispositivo genera un código `XXXX-XXXX-XXXX` (60 bits de entropía).
3. El código se empaqueta como `ECW.{workspaceId}.{inviteId}.{code}` y se comparte por WhatsApp o se dicta por teléfono.
4. El dispositivo nuevo pega el paquete, elige su PIN local, y queda enrolado con la misma Master Key.
5. El dispositivo enrolado **no tiene frase de recuperación**. Si olvida el PIN, se re-enrola desde otro dispositivo.

**La frase de recuperación no sobrevive al borrado de cookies.** La frase descifra la bóveda local, y la bóveda vive en IndexedDB del dispositivo. Borrar las cookies del navegador borra la bóveda, y con ella el blob que la frase abriría. Para volver a entrar después de eso, un dispositivo ya enrolado (owner o admin) tiene que generar un código de conexión nuevo. El respaldo real del owner es **tener un segundo dispositivo enrolado**, no la frase.

El paquete de conexión no se guarda en ningún sitio: quien lo tenga en el chat, lo tiene. Un invite usado se borra best-effort (si el que se enroló entró como staff, no tiene permiso para borrarlo y queda para que lo limpie un dueño).

## Despliegue

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm build
pnpm exec firebase deploy --only firestore:rules,hosting
```

**Código primero, rules después.** Las rules nuevas exigen `ownerUid` en el create del workspace: si se despliegan antes que el código, un bootstrap nuevo no puede crear su workspace. Al revés no rompe nada, porque el código tolera las rules viejas.

## Limitaciones conocidas

- **Bundle ~628 KB minificado (~180 KB gzip).** Warning de chunk size aceptado como deuda. Fase 7: code splitting del SDK de Firebase.
- **Sin offline real.** El service worker cachea el shell, pero Firestore siempre va a red. Registrar un lavado sin conexión no funciona.
- **`apple-touch-icon` apunta a un SVG.** iOS < 16.4 lo ignora. Android y iOS 16.4+ funcionan. Para iOS viejo: convertir `public/icon.svg` a PNG 180×180 con cualquier herramienta offline y actualizar el `<link>`.
- **`listAll` de clientes descifra todo en memoria.** Con >500 clientes puede ser lento. Fase 7: paginación.
- **Import masivo sin idempotencia.** Re-pegar el mismo lote duplica. Fase 7.
- **`recomputeLoyalty` lee el ledger completo sin paginar.** Aceptable hasta ~200 transacciones por cliente.
- **La frase de recuperación solo sirve si la bóveda sigue en el dispositivo.** Borrar cookies, formatear o desinstalar la PWA deja la frase sin blanco. El plan de recuperación del owner es tener un segundo dispositivo enrolado como admin/owner, no la frase.

## Estructura

```
src/
├── core/      dominio puro (tipos, pricing, loyalty, wordlist)
├── infra/     persistencia, crypto, vault, repositorios
└── ui/        páginas, componentes, estilos
public/        assets estáticos (favicon, manifest, SW, icono)
firestore.rules
```

## Licencia

No declarada. Uso interno del negocio.
