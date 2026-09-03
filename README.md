# Backend de extracción de transcripts

Reutiliza el extractor JS ya validado (`extractor_v4_playwright.js`) más
Playwright para visitar cada link compartido de ChatGPT. Guarda un
registro completo por conversación en **MongoDB** (metadatos de la
actividad + todos los turnos, adjuntos, quality_report del extractor),
y entrega un `.zip` con un `.docx` por alumno generado al vuelo.

## Variables de entorno requeridas

- `MONGODB_URI` — cadena de conexión completa de tu clúster de MongoDB
  Atlas (incluye usuario y contraseña), algo como:
  `mongodb+srv://usuario:contraseña@cluster0.xxxxx.mongodb.net/`

Opcionales (tienen valor por defecto si no las pones):
- `MONGODB_DB_NAME` (por defecto `transcripts`)
- `MONGODB_COLLECTION_NAME` (por defecto `conversaciones`)
- `ALLOWED_ORIGIN` — dominio de Vercel del frontend, para restringir
  CORS (por defecto permite cualquier origen)

## Antes de desplegar: crea tu clúster de MongoDB Atlas (gratis)

1. Ve a [mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register)
   y crea una cuenta (puedes usar Google para registrarte, no requiere
   tarjeta para el nivel gratuito).
2. Crea un clúster nuevo, elige el plan **M0 (Free)**.
3. En "Database Access", crea un usuario de base de datos con
   contraseña (guárdala, la vas a necesitar para el URI).
4. En "Network Access", agrega la IP `0.0.0.0/0` ("Allow access from
   anywhere") -- Render usa IPs dinámicas, así que no hay una IP fija
   que poner en la lista blanca.
5. En "Database" → "Connect" → "Drivers", copia el connection string
   (URI) que te da Atlas, y reemplaza `<password>` con la contraseña
   real del usuario que creaste.
6. Pega ese URI completo como la variable `MONGODB_URI` en Render.

## Desplegar en Render

1. Sube este código a tu repositorio de GitHub.
2. En Render: "New" → "Web Service" → conecta el repositorio.
3. Runtime: **Docker** (Render detecta el `Dockerfile` automáticamente).
4. En "Environment", agrega `MONGODB_URI` con el connection string de Atlas.
5. Plan: **Free**.

## Endpoint

`POST /generate`

```json
{
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

Responde con un `.zip` descargable (un `.docx` por alumno). Cada
alumno, exitoso o con error, queda como un documento en la colección
de MongoDB.

## Revisar los datos guardados

Puedes explorar los registros directamente desde el sitio de MongoDB
Atlas ("Browse Collections" en tu clúster) -- tiene una vista tipo
tabla/JSON similar a lo que dabas Sheets, pero como base de datos real
(con filtros, búsquedas, y sin los límites de una hoja de cálculo).
