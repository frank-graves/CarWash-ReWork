// src/infra/firebase-bootstrap.ts
// Inicialización diferida del SDK de Firebase.
// Cacheamos la instancia en el módulo para sobrevivir al HMR de Astro/Vite
// sin re-autenticar al usuario en cada hot-reload.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  signInAnonymously,
  type Auth,
} from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  type Firestore,
} from 'firebase/firestore';
import { FirebaseConfigError } from '@infra/errors';

export interface FirebaseRuntime {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
}

let cachedRuntime: FirebaseRuntime | null = null;

function readEnvConfig() {
  const env = import.meta.env;
  const required = {
    apiKey: env.PUBLIC_FIREBASE_API_KEY,
    authDomain: env.PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: env.PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.PUBLIC_FIREBASE_APP_ID,
  } as const;

  for (const [key, value] of Object.entries(required)) {
    if (!value || typeof value !== 'string') {
      throw new FirebaseConfigError(key);
    }
  }

  // El type guard del loop no narrowea el objeto, así que forzamos
  // el tipo aquí tras la validación. Es seguro porque acabamos de verificar.
  return required as {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
  };
}

export async function bootstrapFirebase(): Promise<FirebaseRuntime> {
  if (cachedRuntime) return cachedRuntime;

  const config = readEnvConfig();
  const app = initializeApp(config);
  const db = getFirestore(app);
  const auth = getAuth(app);

  if (import.meta.env.DEV) {
    // Los emuladores corren en puertos fijos durante desarrollo local.
    // El tercer parámetro (disableWarnings) silencia el banner amarillo del SDK.
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  }

  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }

  cachedRuntime = { app, db, auth };
  return cachedRuntime;
}