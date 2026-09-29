declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof import('./routing'))['routing']['locales'][number];
    Messages: import('./messages').AppMessages;
  }
}

export {};
