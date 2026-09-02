# Frontend — formulario de transcripción

Sitio estático (HTML/CSS/JS puro, sin frameworks ni build step) que
llama al backend en Render y descarga el `.zip` con los `.docx`.

## Estructura

```
frontend/
  index.html   → formulario (metadatos de actividad + filas de alumnos)
  style.css    → diseño
  script.js    → lógica (filas dinámicas, envío, descarga)
  config.js    → URL del backend (editar aquí)
  vercel.json  → config mínima de Vercel
```

## Antes de desplegar

Abre `config.js` y reemplaza la URL de ejemplo por la URL real de tu
backend ya desplegado en Render:

```js
const API_BASE_URL = "https://tu-servicio.onrender.com";
```

Si Render aún no está listo, puedes subir el frontend igual y editar
este archivo (y volver a subirlo) cuando ya tengas la URL — no bloquea
el resto del despliegue.

## Subir esta carpeta al mismo repositorio del backend

Este `frontend/` puede vivir dentro del mismo repo donde ya subiste
`app.py`, `Dockerfile`, etc. (no hace falta un repo aparte). Súbelo
como una carpeta nueva ahí, junto a los archivos del backend.

## Desplegar en Vercel

1. En [vercel.com](https://vercel.com), "Add New" → "Project" → importa
   el mismo repositorio de GitHub.
2. En "Root Directory" (configuración del proyecto), selecciona la
   carpeta **`frontend`** — esto le dice a Vercel que solo sirva esta
   carpeta, ignorando el `Dockerfile`/`app.py` del backend.
3. Framework Preset: "Other" (no hace falta build command, es HTML
   estático).
4. Deploy.

Vercel te da una URL pública (algo como
`transcript-anahuac.vercel.app`) — esa es la página que va a usar el
profesor.

## Nota sobre CORS

El backend (FastAPI) todavía no tiene configurado CORS para aceptar
peticiones desde el dominio de Vercel. Cuando tengas ambas URLs
(Vercel y Render), hay que agregar el dominio de Vercel a la lista de
orígenes permitidos en `app.py` del backend — si no, el navegador
bloqueará la petición aunque el backend esté corriendo bien.
