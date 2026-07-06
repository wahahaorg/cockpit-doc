/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API 基址。默认空字符串走 Vite dev proxy 的相对路径 /api。生产可设为后端绝对地址。 */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
