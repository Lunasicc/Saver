/** Display name. Override locally with VITE_APP_NAME in client/.env.local. */
export const APP_NAME: string = import.meta.env.VITE_APP_NAME?.trim() || 'Saver';
