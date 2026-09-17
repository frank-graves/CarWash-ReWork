// src/infra/tests/vault.test.ts
// El ciclo completo de la bóveda, sin navegador: fake-indexeddb para el
// almacenamiento y el crypto de Node (mismo WebCrypto) para la criptografía.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { RECOVERY_WORDS } from '@core/wordlist';
import { PrivacyVault } from '@infra/crypto';
import { SessionLockedError } from '@infra/errors';
import { hashPlate } from '@infra/hashing';
import { SessionKeyManager } from '@infra/session-key';
import { VAULT_DB_NAME, Vault, closeVaultConnection } from '@infra/vault';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORKSPACE = crypto.randomUUID();
const PIN = '123456';
const OTHER_PIN = '654321';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`No se pudo borrar ${name}`));
  });
}

// Cada test arranca de cero: base borrada y sesión cerrada. Sin esto el segundo
// test hereda el workspaceId del primero y las aserciones empiezan a mentir.
beforeEach(async () => {
  await closeVaultConnection();
  await deleteDatabase(VAULT_DB_NAME);
  SessionKeyManager.lock();
});

describe('Vault.initDevice', () => {
  it('entrega una frase de 12 palabras que existen en la wordlist', async () => {
    const { recoveryPhrase } = await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });

    const words = recoveryPhrase.split(' ');
    expect(words).toHaveLength(12);
    for (const word of words) {
      expect(RECOVERY_WORDS).toContain(word);
    }
  });

  it('deja el dispositivo inicializado, con un workspace opaco y la sesión abierta', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });

    expect(await Vault.isDeviceInitialized()).toBe(true);
    // UUID y no slug: un identificador adivinable permitiría a cualquiera
    // auto-registrarse como operador del negocio.
    expect(await Vault.getWorkspaceId()).toMatch(UUID_PATTERN);
    expect(Vault.isUnlocked()).toBe(true);
  });

  it('recorta el workspaceId antes de guardarlo', async () => {
    await Vault.initDevice({ workspaceId: `  ${WORKSPACE}  `, pin: PIN });
    expect(await Vault.getWorkspaceId()).toBe(WORKSPACE);
  });

  it('se niega a inicializar dos veces: la segunda bóveda dejaría huérfano lo ya cifrado', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });

    await expect(Vault.initDevice({ workspaceId: 'otro-negocio', pin: PIN })).rejects.toThrow(
      'ya tiene una bóveda',
    );
  });

  it('rechaza un PIN que no sea 6 dígitos sin escribir nada', async () => {
    await expect(Vault.initDevice({ workspaceId: WORKSPACE, pin: '12345' })).rejects.toThrow(
      '6 dígitos',
    );
    expect(await Vault.isDeviceInitialized()).toBe(false);
  });
});

describe('Vault.unlockWithPin', () => {
  it('recupera exactamente la misma Master Key: descifra lo que selló la anterior', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    const sealed = await PrivacyVault.encryptPayload({ plate: 'ABC-123' }, Vault.getMasterKey());

    Vault.lock();
    expect(Vault.isUnlocked()).toBe(false);

    await Vault.unlockWithPin(PIN);
    expect(Vault.isUnlocked()).toBe(true);
    expect(await PrivacyVault.decryptPayload(sealed, Vault.getMasterKey())).toEqual({
      plate: 'ABC-123',
    });
  });

  it('la clave HMAC sobrevive al ciclo lock/unlock: la misma placa da la misma huella', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    const before = await hashPlate('ABC-123', Vault.getHmacKey());

    Vault.lock();
    await Vault.unlockWithPin(PIN);

    // Si la clave HMAC no viajara dentro del blob, cada desbloqueo generaría
    // huellas nuevas y toda búsqueda por placa devolvería cero clientes.
    expect(await hashPlate('ABC-123', Vault.getHmacKey())).toBe(before);
  });

  it('rechaza el PIN incorrecto y deja la sesión cerrada', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    Vault.lock();

    await expect(Vault.unlockWithPin('000000')).rejects.toThrow('PIN incorrecto');
    expect(Vault.isUnlocked()).toBe(false);
  });

  it('bloquea el dispositivo al quinto fallo, incluso con el PIN correcto', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    Vault.lock();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(Vault.unlockWithPin('000000')).rejects.toThrow('PIN incorrecto');
    }

    expect(await Vault.getLockoutRemainingMs()).toBeGreaterThan(0);
    await expect(Vault.unlockWithPin(PIN)).rejects.toThrow('Dispositivo bloqueado');
    expect(Vault.isUnlocked()).toBe(false);
  });

  it('sin bóveda en el dispositivo lo dice, no lo disfraza de PIN incorrecto', async () => {
    await expect(Vault.unlockWithPin(PIN)).rejects.toThrow('no tiene una bóveda configurada');
  });
});

describe('Vault.resetWithRecovery', () => {
  it('abre la misma Master Key con un PIN nuevo, y el viejo deja de servir', async () => {
    const { recoveryPhrase } = await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    const sealed = await PrivacyVault.encryptPayload({ plate: 'XYZ-987' }, Vault.getMasterKey());
    Vault.lock();

    await Vault.resetWithRecovery(recoveryPhrase, OTHER_PIN);
    expect(await PrivacyVault.decryptPayload(sealed, Vault.getMasterKey())).toEqual({
      plate: 'XYZ-987',
    });

    Vault.lock();
    await expect(Vault.unlockWithPin(PIN)).rejects.toThrow('PIN incorrecto');

    await Vault.unlockWithPin(OTHER_PIN);
    expect(Vault.isUnlocked()).toBe(true);
  });

  it('tolera mayúsculas, comas y saltos de línea al teclear la frase', async () => {
    const { recoveryPhrase } = await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    Vault.lock();

    const tecleada = recoveryPhrase
      .split(' ')
      .map((word) => word.toUpperCase())
      .join(',\n');

    await Vault.resetWithRecovery(tecleada, OTHER_PIN);
    expect(Vault.isUnlocked()).toBe(true);
  });

  it('rechaza una frase con palabras fuera de la wordlist', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    Vault.lock();

    await expect(Vault.resetWithRecovery('palabras incorrectas aqui', OTHER_PIN)).rejects.toThrow(
      'Frase de recuperación inválida',
    );
  });

  it('rechaza 12 palabras válidas pero equivocadas (lo detecta el tag GCM)', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    Vault.lock();

    const impostora = RECOVERY_WORDS.slice(0, 12).join(' ');
    await expect(Vault.resetWithRecovery(impostora, OTHER_PIN)).rejects.toThrow(
      'Frase de recuperación incorrecta',
    );
    expect(Vault.isUnlocked()).toBe(false);
  });

  it('exige que el PIN nuevo cumpla el formato', async () => {
    const { recoveryPhrase } = await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    Vault.lock();

    await expect(Vault.resetWithRecovery(recoveryPhrase, 'abc')).rejects.toThrow('6 dígitos');
  });
});

describe('Vault.getMasterKey / Vault.getHmacKey', () => {
  it('sin desbloquear lanzan SessionLockedError', () => {
    expect(() => Vault.getMasterKey()).toThrow(SessionLockedError);
    expect(() => Vault.getHmacKey()).toThrow(SessionLockedError);
  });

  it('tras lock() vuelven a lanzar SessionLockedError', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    Vault.lock();

    expect(Vault.isUnlocked()).toBe(false);
    expect(() => Vault.getMasterKey()).toThrow(SessionLockedError);
    expect(() => Vault.getHmacKey()).toThrow(SessionLockedError);
  });
});

describe('Vault.changePin', () => {
  it('re-envuelve la misma Master Key: el PIN nuevo descifra lo sellado antes', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    const sealed = await PrivacyVault.encryptPayload({ plate: 'ABC-123' }, Vault.getMasterKey());

    await Vault.changePin(PIN, OTHER_PIN);
    Vault.lock();

    await Vault.unlockWithPin(OTHER_PIN);
    expect(Vault.isUnlocked()).toBe(true);
    expect(await PrivacyVault.decryptPayload(sealed, Vault.getMasterKey())).toEqual({
      plate: 'ABC-123',
    });
  });

  it('el PIN viejo deja de abrir la bóveda', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    await Vault.changePin(PIN, OTHER_PIN);
    Vault.lock();

    await expect(Vault.unlockWithPin(PIN)).rejects.toThrow('PIN incorrecto');

    await Vault.unlockWithPin(OTHER_PIN);
    expect(Vault.isUnlocked()).toBe(true);
  });

  it('con el PIN actual incorrecto lanza, cuenta el fallo y no toca la bóveda', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });

    // El mensaje ya no distingue "actual": changePin pasa por verifyPin, la misma
    // puerta que unlockWithPin, y un PIN equivocado es un PIN equivocado.
    await expect(Vault.changePin('000000', OTHER_PIN)).rejects.toThrow('PIN incorrecto');

    // El PIN de siempre sigue abriendo: la bóveda quedó intacta.
    Vault.lock();
    await Vault.unlockWithPin(PIN);
    expect(Vault.isUnlocked()).toBe(true);
  });

  it('cambiar el PIN con la sesión cerrada devuelve también la clave HMAC', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    const before = await hashPlate('ABC-123', Vault.getHmacKey());

    // Aquí es donde muerde el bug: changePin no exige sesión abierta, pero deja
    // la sesión abierta al terminar. Si no re-importa la HMAC key, getHmacKey()
    // lanza SessionLockedError con isUnlocked() en true, y toda búsqueda por
    // placa revienta sin explicación.
    Vault.lock();
    await Vault.changePin(PIN, OTHER_PIN);

    expect(Vault.isUnlocked()).toBe(true);
    expect(await hashPlate('ABC-123', Vault.getHmacKey())).toBe(before);
  });

  it('exige el formato de 6 dígitos solo en el PIN nuevo', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });

    // El PIN actual ya no se valida por formato: '12345' no abre el blob, verifyPin
    // lo cuenta como fallo y responde 'PIN incorrecto'. Rechazado igual, con otro texto.
    await expect(Vault.changePin('12345', OTHER_PIN)).rejects.toThrow('PIN incorrecto');
    await expect(Vault.changePin(PIN, 'abc')).rejects.toThrow('El nuevo PIN');
  });
});

describe('Vault enrollment', () => {
  it('generateInviteCode entrega 12 símbolos en tres grupos', () => {
    const code = Vault.generateInviteCode();

    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(code).toHaveLength(14); // 12 símbolos + 2 guiones
  });

  it('dos códigos consecutivos no coinciden', () => {
    expect(Vault.generateInviteCode()).not.toBe(Vault.generateInviteCode());
  });

  it('enrola un segundo dispositivo: descifra lo sellado por el primero y firma las mismas placas', async () => {
    // --- Dispositivo A: ya enrolado, con datos sellados y clientes indexados.
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    const sealed = await PrivacyVault.encryptPayload({ plate: 'ABC-123' }, Vault.getMasterKey());
    const plateHashFromA = await hashPlate('ABC-123', Vault.getHmacKey());

    const code = Vault.generateInviteCode();
    const invite = await Vault.createInviteBlob(code);

    // A se queda sin bóveda (IndexedDB incluido): el paquete tiene que bastar.
    Vault.lock();
    await Vault.wipeDevice();
    expect(await Vault.isDeviceInitialized()).toBe(false);

    // --- Dispositivo B: llega con el paquete y un PIN nuevo, sin bóveda previa.
    await Vault.enrollFromInvite({
      workspaceId: WORKSPACE,
      blobInvite: invite.blobInvite,
      inviteSalt: invite.inviteSalt,
      ivInvite: invite.ivInvite,
      code,
      newPin: OTHER_PIN,
    });

    expect(await Vault.isDeviceInitialized()).toBe(true);
    expect(Vault.isUnlocked()).toBe(true);
    // El workspace viaja en el paquete y queda escrito en la misma transacción
    // que el resto de slots. Sin esto, el shell del dispositivo nuevo se queda
    // en "Cargando…" para siempre (bóveda abierta, workspace desconocido).
    expect(await Vault.getWorkspaceId()).toBe(WORKSPACE);
    expect(await PrivacyVault.decryptPayload(sealed, Vault.getMasterKey())).toEqual({
      plate: 'ABC-123',
    });

    // La clave HMAC viaja dentro del mismo sobre: sin ella, B calcularía huellas
    // de matrícula distintas a las de A y no encontraría ni un cliente.
    expect(await hashPlate('ABC-123', Vault.getHmacKey())).toBe(plateHashFromA);
  });

  it('con el código equivocado no descifra nada', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    const invite = await Vault.createInviteBlob(Vault.generateInviteCode());

    await expect(
      Vault.enrollFromInvite({
        workspaceId: WORKSPACE,
        blobInvite: invite.blobInvite,
        inviteSalt: invite.inviteSalt,
        ivInvite: invite.ivInvite,
        code: 'ZZZZ-ZZZZ-ZZZZ',
        newPin: OTHER_PIN,
      }),
    ).rejects.toThrow('Código de conexión incorrecto');
  });

  it('sin workspaceId no enrola nada', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    const code = Vault.generateInviteCode();
    const invite = await Vault.createInviteBlob(code);

    await expect(
      Vault.enrollFromInvite({
        workspaceId: '   ',
        blobInvite: invite.blobInvite,
        inviteSalt: invite.inviteSalt,
        ivInvite: invite.ivInvite,
        code,
        newPin: OTHER_PIN,
      }),
    ).rejects.toThrow('Falta el identificador del negocio');
  });

  it('normaliza el código antes de derivar (minúsculas, espacios y guiones corridos)', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    const code = Vault.generateInviteCode();
    const invite = await Vault.createInviteBlob(code);
    Vault.lock();
    await Vault.wipeDevice();

    await Vault.enrollFromInvite({
      workspaceId: WORKSPACE,
      blobInvite: invite.blobInvite,
      inviteSalt: invite.inviteSalt,
      ivInvite: invite.ivInvite,
      // Tal cual sale de pegarlo desde WhatsApp después de dictarlo por teléfono.
      code: `  ${code.toLowerCase().replace(/-/g, '')}  `,
      newPin: OTHER_PIN,
    });

    expect(Vault.isUnlocked()).toBe(true);
    expect(await Vault.getWorkspaceId()).toBe(WORKSPACE);
  });

  it('hasRecoveryPhrase distingue bootstrap de enrollment', async () => {
    await Vault.initDevice({ workspaceId: WORKSPACE, pin: PIN });
    expect(await Vault.hasRecoveryPhrase()).toBe(true);

    const code = Vault.generateInviteCode();
    const invite = await Vault.createInviteBlob(code);
    Vault.lock();
    await Vault.wipeDevice();
    expect(await Vault.hasRecoveryPhrase()).toBe(false);

    await Vault.enrollFromInvite({
      workspaceId: WORKSPACE,
      blobInvite: invite.blobInvite,
      inviteSalt: invite.inviteSalt,
      ivInvite: invite.ivInvite,
      code,
      newPin: OTHER_PIN,
    });

    // El enrolamiento no la escribe: la UI no puede ofrecer una frase que no existe.
    expect(await Vault.hasRecoveryPhrase()).toBe(false);
  });
});
