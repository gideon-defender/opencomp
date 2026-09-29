declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof import('./routing'))['routing']['locales'][number];
    Messages: typeof import('../messages/en.json');
  }
}

export {};
