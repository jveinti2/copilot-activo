# Copilot Activo - Audiohook Reference Implementation

## Descripción

Copilot Activo es una aplicación de referencia para la transcripción y respuesta automática de llamadas en tiempo real, orientada a contact centers. Recibe audio vía WebSocket, transcribe la voz a texto, sintetiza la pregunta del cliente y responde usando un modelo de IA. Incluye una interfaz web tipo chat para visualizar la conversación en tiempo real.

## Arquitectura

- **Frontend:** HTML/JS simple (sin frameworks), WebSocket para mensajes en tiempo real.
- **Backend:** Node.js + Fastify, WebSocket, procesamiento de audio, integración con OpenAI Whisper y modelo de respuesta.
- **Sin base de datos** (logs y audios en disco local).

```
[Cliente Web] <---WebSocket---> [Servidor Node.js (Fastify)]
                                      |---> [OpenAI Whisper (transcripción)]
                                      |---> [Modelo IA (respuesta)]
```

## Tecnologías usadas

- Node.js 16+
- Fastify
- WebSocket
- OpenAI Whisper (API o local)
- HTML, CSS, JS (frontend)

## Requisitos previos

- Node.js 16 o superior
- npm
- (Opcional) Acceso a OpenAI Whisper o modelo local

## Instalación

```bash
# Clonar el repositorio
git clone <repo-url>
cd audiohook-reference-implementation-main

# Instalar dependencias
npm install

# Compilar el proyecto
npm run build
```

## Variables de entorno

Crea un archivo `.env` en la raíz con:

```
NODE_ENV=development  # o production
SERVERPORT=8001
SERVERHOST=0.0.0.0
LOG_ROOT_DIR=./logs
```

## Cómo correrlo

```bash
npm start
```

El servidor quedará disponible en: [http://localhost:8001](http://localhost:8001)

## Endpoints principales

- **WebSocket de audio:**

  - `ws://localhost:8001/api/v1/audiohook/ws`
  - Headers requeridos: `audiohook-session-id` (UUID)

- **Frontend web (chat):**

  - `http://localhost:8001/` (sirve `public/index.html`)

- **Healthcheck:**
  - `GET /health/check`

## Ejemplo de prueba rápida

```bash
npm install -g wscat
wscat -c "ws://localhost:8001/api/v1/audiohook/ws" -H "audiohook-session-id:12345678-1234-1234-1234-123456789012"
```

## Notas y recomendaciones para producción

- Escalar el backend con balanceador de carga si se esperan muchas sesiones simultáneas.
- Implementar persistencia en base de datos para logs y transcripciones si se requiere auditoría.
- Añadir autenticación/autorización para ambientes reales.
- Monitorear recursos y errores (integrar con Prometheus, Grafana, Sentry, etc.).

---

**Contacto:**
Para dudas técnicas, revisar el código fuente o abrir un issue en el repositorio.
