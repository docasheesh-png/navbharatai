/// <reference types="vite/client" />
// Task 1.6 — Environment config system (dev / staging / prod)

export const env = {
  isDev:     import.meta.env.DEV,
  isProd:    import.meta.env.PROD,
  isStaging: import.meta.env.MODE === 'staging',
  mode:      import.meta.env.MODE as 'development' | 'staging' | 'production',
  api: {
    navbharatai: '/api/chat/navbharatai',
    pro:         '/api/chat/navbharatai-pro',
    wallet:      '/api/wallet',
    cashfree:    '/api/cashfree',
    github:      '/api/auth/github',
  },
} as const;
