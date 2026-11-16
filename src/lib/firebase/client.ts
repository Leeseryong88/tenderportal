import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'demo-iicombined-tender.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'demo-iicombined-tender',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'demo-iicombined-tender.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:000000000000:web:demo',
};

let emulatorsConnected = false;
let appCheckInitialized = false;

export function getFirebaseClientApp(): FirebaseApp {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  if (typeof window !== 'undefined' && !appCheckInitialized) {
    const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY;
    if (siteKey) {
      try {
        initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(siteKey),
          isTokenAutoRefreshEnabled: true,
        });
      } catch {
        // Ignore duplicate initialization during HMR
      }
    }
    appCheckInitialized = true;
  }
  return app;
}

export function getFirebaseClientAuth(): Auth {
  const app = getFirebaseClientApp();
  const auth = getAuth(app);
  if (
    typeof window !== 'undefined' &&
    !emulatorsConnected &&
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true'
  ) {
    const host = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    try {
      connectAuthEmulator(auth, `http://${host}`, { disableWarnings: true });
    } catch {
      // Already connected
    }
  }
  return auth;
}

export function getFirebaseClientStorage(): FirebaseStorage {
  const app = getFirebaseClientApp();
  const storage = getStorage(app);
  if (
    typeof window !== 'undefined' &&
    !emulatorsConnected &&
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true'
  ) {
    const raw = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
    const [host, portStr] = raw.split(':');
    try {
      connectStorageEmulator(storage, host, Number(portStr || 9199));
    } catch {
      // Already connected
    }
  }
  emulatorsConnected = true;
  return storage;
}

/**
 * Storage only attaches an ID token when Auth is initialized and its persisted user has been restored,
 * so callers must use this before client uploads. `expectedUid` is the uid the server embedded in the
 * staging path; a different signed-in Firebase user would be rejected by the Storage rules anyway.
 */
export async function getAuthenticatedStorage(expectedUid?: string): Promise<FirebaseStorage> {
  const auth = getFirebaseClientAuth();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user || (expectedUid && user.uid !== expectedUid)) {
    throw Object.assign(new Error('Client sign-in does not match the server session.'), {
      code: 'storage/unauthenticated',
    });
  }
  await user.getIdToken();
  return getFirebaseClientStorage();
}

/** The uploader uid segment of a server-issued staging path (`staging/{tenant}/{tender}/{scope}/{uid}/…`). */
export function stagingPathUid(stagingPath: string): string | undefined {
  return stagingPath.split('/')[4];
}
