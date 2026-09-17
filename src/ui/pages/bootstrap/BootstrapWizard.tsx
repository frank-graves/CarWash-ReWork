// src/ui/pages/bootstrap/BootstrapWizard.tsx
// Cuatro pasos, un solo objetivo: que la frase de recuperación acabe en papel.
//
// El orden importa. La bóveda se forja en el paso 3 → 4, ANTES de escribir nada en
// la nube: si el operador cierra aquí, no hay workspace a medias. Y la frase no se
// muestra hasta que se ha forjado, porque hasta entonces no existe.

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { bootstrapFirebase } from '@infra/firebase-bootstrap';
import { OperatorRepository } from '@infra/operator-repository';
import { Vault, normalizePhrase } from '@infra/vault';
import { appPhase } from '@ui/appState';
import { PinPad } from '@ui/components/PinPad';
import styles from './BootstrapWizard.module.css';

type Step = 0 | 1 | 2 | 3 | 4;

// Sigue viviendo aquí (no se movió al componente) porque `forgeVault` la usa para
// validar la longitud del PIN: la regla de negocio no depende del teclado.
const PIN_SLOTS = [0, 1, 2, 3, 4, 5] as const;

const step = signal<Step>(0);
const businessName = signal('');
const workspaceId = signal('');
const ownerName = signal('');
const pin = signal('');
const confirmPin = signal('');
const understood = signal(false);
const recoveryPhrase = signal('');
const error = signal('');
const isWorking = signal(false);

// Las dos palabras que el operador debe copiar del papel. Elegidas de en medio de la
// frase: si se salta un renglón al anotarla, la 4 y la 9 lo pillan.
const witnessA = signal('');
const witnessB = signal('');
const WITNESS_SPOTS = [
  { position: 4, index: 3, field: witnessA },
  { position: 9, index: 8, field: witnessB },
] as const;

export function BootstrapWizard() {
  // Cada montaje arranca en el paso 0 (elegir camino). El estado del módulo ya no
  // lo limpia el reload, y un wizard remontado en el paso 4 mostraría la frase de
  // una bóveda que puede estar borrada (wipeDevice) y reescribiría el workspace.
  useEffect(() => {
    step.value = 0;
    businessName.value = '';
    workspaceId.value = '';
    ownerName.value = '';
    pin.value = '';
    confirmPin.value = '';
    understood.value = false;
    recoveryPhrase.value = '';
    witnessA.value = '';
    witnessB.value = '';
    error.value = '';
    isWorking.value = false;
  }, []);

  // Cerrar la pestaña con la frase en pantalla es perderla para siempre. El aviso
  // del navegador es feo; menos feo que un negocio sin acceso a sus propios datos.
  useEffect(() => {
    if (step.value !== 4) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [step.value]);

  const submitBusiness = () => {
    const name = businessName.value.trim();
    if (name.length < 3) {
      error.value = 'El nombre del negocio necesita al menos 3 letras';
      return;
    }
    businessName.value = name;
    // El identificador interno es opaco a propósito. Un slug derivado del nombre
    // ("carwash-lima-centro") se adivina desde fuera, y con el workspaceId adivinado
    // cualquiera puede auto-registrarse como operador del negocio.
    workspaceId.value = crypto.randomUUID();
    error.value = '';
    step.value = 2;
  };

  const submitOwner = () => {
    const name = ownerName.value.trim();
    if (name.length < 3) {
      error.value = 'El nombre del administrador necesita al menos 3 letras';
      return;
    }
    ownerName.value = name;
    error.value = '';
    step.value = 3;
  };

  const forgeVault = async () => {
    if (pin.value.length !== PIN_SLOTS.length) {
      error.value = 'El PIN son 6 dígitos';
      return;
    }
    if (pin.value !== confirmPin.value) {
      error.value = 'Los dos PINs no coinciden';
      return;
    }
    if (!understood.value) {
      error.value = 'Confirma que entiendes qué pasa si olvidas el PIN';
      return;
    }

    error.value = '';
    isWorking.value = true;
    try {
      // Dos PBKDF2 de 200k iteraciones: cerca de un segundo en un móvil modesto.
      // Es el precio de que un PIN de seis dígitos signifique algo.
      const forged = await Vault.initDevice({ workspaceId: workspaceId.value, pin: pin.value });
      recoveryPhrase.value = forged.recoveryPhrase;
      witnessA.value = '';
      witnessB.value = '';
      step.value = 4;
    } catch (thrown) {
      error.value = thrown instanceof Error ? thrown.message : 'No se pudo forjar la bóveda';
    } finally {
      isWorking.value = false;
    }
  };

  const witnessesMatch = (expected: readonly string[]): boolean =>
    WITNESS_SPOTS.every(
      (spot) => normalizePhrase(spot.field.value) === (expected[spot.index] ?? ''),
    );

  const finishBootstrap = async () => {
    if (!witnessesMatch(recoveryPhrase.value.split(' '))) {
      const positions = WITNESS_SPOTS.map((spot) => spot.position).join(' y la ');
      error.value = `La palabra ${positions} no coinciden con lo que hay en pantalla. Repasa el papel.`;
      return;
    }

    error.value = '';
    isWorking.value = true;
    try {
      const runtime = await bootstrapFirebase();
      // El uid del dueño se escribe en el doc del workspace ANTES que su doc de
      // operador: la rule de `operators` create lee `ownerUid` para autorizar el
      // primer alta. Invertir el orden deja el wizard sin poder crear al owner.
      const uid = runtime.auth.currentUser?.uid;
      if (!uid) throw new Error('Sin usuario autenticado tras bootstrapFirebase');
      await setDoc(doc(runtime.db, 'workspaces', workspaceId.value), {
        name: businessName.value,
        createdAt: serverTimestamp(),
        schemaVersion: 1,
        ownerUid: uid,
      });
      await new OperatorRepository(runtime, workspaceId.value)
        .ensureBootstrap(ownerName.value, 'owner');
      // Sin recarga: la fase cambia y el shell se monta sobre la bóveda que acabamos
      // de forjar. Recargar aquí tiraba la Master Key recién creada y devolvía al
      // operador a la pantalla de desbloqueo.
      appPhase.value = 'app';
    } catch (thrown) {
      error.value =
        thrown instanceof Error
          ? `No se pudo cerrar la configuración: ${thrown.message}`
          : 'Error conectando con la base de datos';
      isWorking.value = false;
    }
  };

  return (
    <div class={styles.wizard}>
      <header class={styles.header}>
        <h1 class={styles.title}>Configuración inicial</h1>
        {step.value > 0 && <p class={styles.subtitle}>Paso {step.value} de 4</p>}
      </header>

      <div class={styles.content}>
        {step.value === 0 && (
          <div class={styles.step}>
            <button
              type="button"
              class={styles.modeBtn}
              onClick={() => { step.value = 1; }}
            >
              <span class={styles.modeBtnTitle}>Crear un negocio nuevo</span>
              <span class={styles.modeBtnHint}>
                Vas a generar la frase de recuperación y ser el dueño.
              </span>
            </button>

            <button
              type="button"
              class={styles.modeBtn}
              onClick={() => { appPhase.value = 'enroll'; }}
            >
              <span class={styles.modeBtnTitle}>Unirme con un código</span>
              <span class={styles.modeBtnHint}>
                Tu tablet ya tiene un negocio; te sumás con un código de conexión.
              </span>
            </button>
          </div>
        )}

        {step.value === 1 && (
          <div class={styles.step}>
            <label class={styles.label} for="negocio">
              Nombre del negocio
            </label>
            <input
              id="negocio"
              class={styles.input}
              type="text"
              value={businessName.value}
              autocomplete="off"
              spellcheck={false}
              onInput={(event) => {
                businessName.value = event.currentTarget.value;
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitBusiness();
              }}
            />
          </div>
        )}

        {step.value === 2 && (
          <div class={styles.step}>
            <label class={styles.label} for="administrador">
              Nombre del administrador
            </label>
            <input
              id="administrador"
              class={styles.input}
              type="text"
              value={ownerName.value}
              autocomplete="off"
              spellcheck={false}
              onInput={(event) => {
                ownerName.value = event.currentTarget.value;
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitOwner();
              }}
            />
            <p class={styles.hint}>Es el nombre que verá el resto del equipo en el historial.</p>
          </div>
        )}

        {step.value === 3 && (
          <div class={styles.step}>
            <PinPad value={pin} label="PIN de seguridad" />
            <PinPad value={confirmPin} label="Repite el PIN" />
            <label class={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={understood.value}
                onChange={(event) => {
                  understood.value = event.currentTarget.checked;
                }}
              />
              <span>
                Entiendo que si olvido el PIN solo podré recuperar el acceso con la frase de
                recuperación, y que si pierdo también la frase los datos no se pueden abrir.
              </span>
            </label>
          </div>
        )}

        {step.value === 4 && (
          <div class={styles.step}>
            <div class={styles.warningBanner}>
              Anota estas 12 palabras en papel. No se vuelven a mostrar. Nada de fotos, nada de
              nube, nada de notas del móvil.
            </div>

            <div class={styles.phraseGrid}>
              {recoveryPhrase.value.split(' ').map((word, index) => (
                <div key={`${index}-${word}`} class={styles.word}>
                  <span class={styles.wordIndex}>{index + 1}</span>
                  {word}
                </div>
              ))}
            </div>

            <p class={styles.hint}>
              El papel es la única copia que existe. Ni el servidor ni yo podemos reconstruirla.
            </p>

            <div class={styles.witness}>
              {WITNESS_SPOTS.map((spot) => (
                <label key={spot.position} class={styles.witnessField}>
                  <span class={styles.label}>Escribe la palabra {spot.position}</span>
                  <input
                    class={styles.input}
                    type="text"
                    value={spot.field.value}
                    autocomplete="off"
                    spellcheck={false}
                    onInput={(event) => {
                      spot.field.value = event.currentTarget.value;
                    }}
                  />
                </label>
              ))}
            </div>

            <p class={styles.hint}>
              No es burocracia: es la única forma de saber que la frase está en el papel antes de
              que desaparezca de la pantalla.
            </p>
          </div>
        )}

        {error.value && (
          <p class={styles.error} role="alert">
            {error.value}
          </p>
        )}
      </div>

      <div class={styles.actions}>
        {step.value === 1 && (
          <button type="button" class={styles.btn} onClick={submitBusiness}>
            Continuar
          </button>
        )}
        {step.value === 2 && (
          <button type="button" class={styles.btn} onClick={submitOwner}>
            Continuar
          </button>
        )}
        {step.value === 3 && (
          <button type="button" class={styles.btn} onClick={forgeVault} disabled={isWorking.value}>
            {isWorking.value ? 'Forjando la bóveda…' : 'Generar frase de recuperación'}
          </button>
        )}
        {step.value === 4 && (
          <button
            type="button"
            class={styles.btn}
            onClick={finishBootstrap}
            disabled={isWorking.value}
          >
            {isWorking.value ? 'Cerrando la configuración…' : 'Ya las tengo en papel'}
          </button>
        )}
      </div>
    </div>
  );
}
