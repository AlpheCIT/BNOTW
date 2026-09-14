/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the coach narrator proxy lives. Empty disables narration. */
  readonly VITE_COACH_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
