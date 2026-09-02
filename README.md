# Backend de extracción de transcripts

Reutiliza el extractor JS ya validado (`extractor_v4_playwright.js`) más
Playwright para visitar cada link compartido de ChatGPT, sube el JSON
crudo a Google Drive, escribe una fila de metadatos en un Google Sheet
(uno por actividad, creado automáticamente si no existe), y entrega un
`.zip` con un `.docx` por alumno.

## Variables de entorno requeridas

- `GOOGLE_SERVICE_ACCOUNT_JSON` — el contenido COMPLETO del archivo
  `.json` de la cuenta de servicio (no una ruta de archivo, el JSON
  en sí, pegado como una sola variable). En Render esto se configura
  en "Environment" → "Add Environment Variable", nunca se sube al
  repositorio.

## Antes de desplegar

Comparte la carpeta de Drive donde quieres que vivan los Sheets y los
JSON con el correo de la cuenta de servicio (algo como
`transcript-backend@transcript-anahuac.iam.gserviceaccount.com`), con
permiso de **Editor**. Sin este paso el backend no podrá leer ni
escribir ahí.

## Desplegar en Render

1. Sube este código a tu repositorio de GitHub (`git add . && git commit -m "backend scaffold" && git push`).
2. En Render: "New" → "Web Service" → conecta el repositorio.
3. Runtime: **Docker** (Render detecta el `Dockerfile` automáticamente).
4. En "Environment", agrega `GOOGLE_SERVICE_ACCOUNT_JSON` con el
   contenido del `.json` de la cuenta de servicio.
5. Plan: **Free** (750 horas/mes gratis; el servicio se duerme tras
   15 min de inactividad y tarda ~30-60s en despertar en la siguiente
   petición — no afecta nuestro flujo, que ya toma varios minutos por
   el scroll cuidadoso del extractor).

## Endpoint

`POST /generate`

```json
{
  "carpeta_drive_id": "1LtZ0T148S5JIeJpLxVse-D4NfchtSEQk",
  "curso": "Diseño y desarrollo de productos",
  "clave_materia": "ING3702",
  "programa": "Ingeniería en...",
  "arranque": "20081 (A43)",
  "actividad_nombre": "De la detección de necesidades al diseño del sistema de producto",
  "actividad_numero": "Actividad 2",
  "fecha_limite": "26 de abril de 2026",
  "alumnos": [
    { "nombre": "Linares Malfavón, Jorge Luis", "link": "https://chatgpt.com/share/...", "fecha_envio": "26 de abril de 2026 14:57" }
  ]
}
```

Responde con un `.zip` descargable (uno de los `.docx` por alumno).

## Pendiente (siguiente iteración)

- Conectar con el formulario en Vercel (llamada `fetch` a este
  endpoint).
- Pantalla de espera/progreso mientras corre la extracción.
