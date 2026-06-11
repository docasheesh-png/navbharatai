/// <reference types="vite/client" />
// Firebase configuration — reads from Vite env vars with compile-time fallbacks.
// To override locally: create .env.local with VITE_FIREBASE_* values (gitignored).
// For production: set substitution variables in cloudbuild.yaml.

export const firebaseConfig = {
  projectId:        import.meta.env.VITE_FIREBASE_PROJECT_ID       || 'gen-lang-client-0866594388',
  appId:            import.meta.env.VITE_FIREBASE_APP_ID            || '1:950841184325:web:5f54018ec63af0376d132c',
  apiKey:           import.meta.env.VITE_FIREBASE_API_KEY           || 'AIzaSyAGIUMRMGgD4MTUxflH4pVbVhVleM0LdwE',
  authDomain:       import.meta.env.VITE_FIREBASE_AUTH_DOMAIN       || 'gen-lang-client-0866594388.firebaseapp.com',
  firestoreDbId:    import.meta.env.VITE_FIREBASE_FIRESTORE_DB      || 'ai-studio-cc9cd998-d842-4462-9833-b44f49825878',
  storageBucket:    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET    || 'gen-lang-client-0866594388.firebasestorage.app',
  messagingSenderId:import.meta.env.VITE_FIREBASE_MESSAGING_SENDER  || '950841184325',
  measurementId:    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID    || '',
};
