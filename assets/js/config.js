/* =====================================================================
   CONFIGURACIÓN DE CONEXIÓN
   ---------------------------------------------------------------------
   Pon aquí los datos de tu proyecto de Supabase y todos los dispositivos
   quedarán conectados automáticamente.

   Los encuentras en:  Supabase → Project Settings → API
     · SUPABASE_URL       = "Project URL"
     · SUPABASE_ANON_KEY  = "anon public" (o "publishable key")

   La clave anon es pública y está pensada para vivir en el navegador; la
   información se protege con las políticas de database/instalar.sql.
   NUNCA pongas aquí la clave `service_role`.

   Si los dejas vacíos, la app los pide la primera vez en cada dispositivo
   (o puedes entrar en modo demo para probarla sin base de datos).
   ===================================================================== */

export const SUPABASE_URL = 'https://gkdgdkxhlftzezjbigna.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_iiJEr96Pf-66kAkgalT4NQ_qXqVe7iH';

export const APP_NAME = 'Trabajos de la papelería';

export const LS_KEYS = {
  connection: 'tickets_papeleria_conexion',
  demo:       'tickets_papeleria_demo',
  filtro:     'tickets_papeleria_filtro',
  vista:      'tickets_papeleria_vista',
};
