import { EventEntityDataTranscript } from "../audiohook/src/protocol";

// Interfaz para la solicitud a la API
export interface ApiRequest {
  transcription: string;
  sessionId: string;
  timestamp: number;
  language?: string;
  metadata?: Record<string, any>;
}

// Interfaz para la respuesta de la API
export interface ApiResponse {
  responseId: string;
  suggestion: string;
  confidence: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * Simula una petición a una API externa que procesa transcripciones
 * @param transcript La transcripción a procesar
 * @param sessionId ID de la sesión actual
 * @param metadata Metadatos adicionales
 * @returns Promesa que resuelve con la respuesta de la API simulada
 */
export async function simulateApiRequest(
  transcript: EventEntityDataTranscript,
  sessionId: string,
  metadata?: Record<string, any>
): Promise<ApiResponse> {
  console.log(
    `[API Simulation] Procesando transcripción para sesión: ${sessionId}`
  );

  // Extraemos el texto de la transcripción
  let transcriptionText = "";

  if (transcript.alternatives && transcript.alternatives.length > 0) {
    const alternative = transcript.alternatives[0];
    if (alternative.interpretations && alternative.interpretations.length > 0) {
      transcriptionText = alternative.interpretations[0].transcript || "";
    }
  }

  // Creamos la solicitud
  const request: ApiRequest = {
    transcription: transcriptionText,
    sessionId,
    timestamp: Date.now(),
    metadata,
  };

  // Simulamos una latencia de red
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Generamos una respuesta simulada basada en la transcripción
  let suggestion = "Lo siento, no puedo entender la consulta.";

  // Simulamos diferentes respuestas basadas en palabras clave en la transcripción
  if (transcriptionText.toLowerCase().includes("ayuda")) {
    suggestion = "¿En qué puedo ayudarte hoy?";
  } else if (transcriptionText.toLowerCase().includes("problema")) {
    suggestion = "Lamento que tengas problemas. Vamos a solucionarlo juntos.";
  } else if (transcriptionText.toLowerCase().includes("gracias")) {
    suggestion = "De nada, estoy aquí para ayudarte.";
  } else if (transcriptionText.length > 0) {
    suggestion = `He recibido tu mensaje: "${transcriptionText}". ¿Podrías proporcionarme más detalles?`;
  }

  // Creamos la respuesta
  const response: ApiResponse = {
    responseId: `resp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    suggestion,
    confidence: 0.85 + Math.random() * 0.15, // Entre 0.85 y 1.0
    timestamp: Date.now(),
    metadata: {
      source: "api-simulation",
      processingTimeMs: Math.floor(Math.random() * 150) + 50, // Entre 50 y 200ms
    },
  };

  console.log(`[API Simulation] Respuesta generada: ${response.suggestion}`);

  return response;
}
