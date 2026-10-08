# Trabajos de la papelería — tablero de tickets

Tablero visual (Por hacer → En proceso → Listo para entregar → Entregado) donde cada
trabajo es un ticket con cliente, instrucciones, fotos, fecha de inicio, fecha de entrega
y responsable. HTML + JS sin build, datos en Supabase, se actualiza en vivo en todas
las pantallas.

## Instalar (una sola vez)

1. **Crear proyecto** en supabase.com (plan gratis alcanza).
2. **Base de datos:** SQL Editor → pegar todo `database/instalar.sql` → *Run*.
   Crea las tablas, la seguridad, el bucket privado de fotos y el tiempo real.
3. **Usuarios:** Authentication → Users → *Add user* → correo + contraseña con
   *Auto Confirm User*. Uno por persona o una cuenta compartida del mostrador.
   Recomendado: Authentication → Sign In / Providers → apagar *Allow new users to sign up*.
4. **Conectar:** Project Settings → API → copiar *Project URL* y la clave *anon/publishable*
   en `assets/js/config.js`. (Si se deja vacío, la app los pide en cada dispositivo.)
5. **Publicar:** subir la carpeta a GitHub Pages / Netlify / Vercel, o probar local con
   `node serve.mjs` → http://localhost:4190

## Uso

- **＋ Nuevo ticket:** cliente, trabajo, instrucciones, fotos (cámara, arrastrar o Ctrl+V),
  fechas, responsable, urgente.
- **Mover de estado:** arrastrar la tarjeta a otra columna, el botón del talón
  (“Empezar”, “Marcar listo”…), o los pasos dentro del ticket.
- **Colores de fecha:** rojo vencido · amarillo hoy · crema mañana/pronto.
- **Imprimir hoja:** dentro del ticket, para pegarla junto al trabajo en el taller.
- **⚙ Ajustes:** agregar responsables, cambiar su color, desactivarlos o eliminarlos.
- **Modo demo:** en la pantalla de conexión, para probar sin base de datos.

Las fotos se reducen a ~1600 px antes de subirse (≈250 KB cada una).
