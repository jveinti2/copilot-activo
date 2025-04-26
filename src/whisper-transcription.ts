import axios from "axios";
import dotenv from "dotenv";
import FormData from "form-data";
import fs from "fs";
import { Configuration, OpenAIApi } from "openai";

// Asegurar que dotenv se carga primero
dotenv.config();

// Configuración de la API de OpenAI
const OPENAI_API_KEY = process.env["OPENAI_API_KEY"] || "";
console.log(
  "Estado API KEY:",
  OPENAI_API_KEY ? "Configurada ✅" : "No configurada ❌"
);

if (!OPENAI_API_KEY) {
  console.warn(
    "⚠️ No se ha configurado OPENAI_API_KEY en las variables de entorno. La transcripción con Whisper no funcionará correctamente."
  );
}

// Inicializar el cliente de OpenAI
const configuration = new Configuration({
  apiKey: OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Tipo para la respuesta de la transcripción de Whisper
export interface WhisperTranscriptionResult {
  text: string;
  segments: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
    tokens: number[];
    confidence: number;
  }>;
}

// Tipo para la respuesta extendida de OpenAI (no está incluido en la definición oficial)
interface OpenAIVerboseResponse {
  text: string;
  segments?: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
    tokens?: number[];
    confidence?: number;
  }>;
}

/**
 * Envía un archivo de audio a la API de OpenAI Whisper para transcribirlo
 * @param audioFilePath Ruta al archivo de audio a transcribir
 * @returns Promesa que resuelve con el resultado de la transcripción
 */
export async function transcribeWithWhisper(
  audioFilePath: string
): Promise<WhisperTranscriptionResult> {
  if (!OPENAI_API_KEY) {
    throw new Error(
      "No se ha configurado OPENAI_API_KEY en las variables de entorno"
    );
  }

  try {
    // Enfoque más básico y directo
    const formData = new FormData();

    // Añadir el archivo directamente como un buffer con nombre
    const fileBuffer = fs.readFileSync(audioFilePath);

    // Crear una copia del archivo para inspección
    const debugFilePath = audioFilePath.replace(".wav", "-debug.wav");
    fs.writeFileSync(debugFilePath, fileBuffer);

    // Añadir el archivo a FormData con nombre específico
    formData.append("file", fileBuffer, {
      filename: "audio.wav",
      contentType: "audio/wav",
    });

    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    formData.append("language", "es");

    // Configuración más detallada para la petición HTTP
    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 30000, // 30 segundos de timeout
      }
    );

    // Guardar respuesta completa para depuración
    fs.writeFileSync(
      audioFilePath.replace(".wav", "-response.json"),
      JSON.stringify(response.data, null, 2)
    );

    // Adaptar la respuesta al formato WhisperTranscriptionResult
    const result: WhisperTranscriptionResult = {
      text: response.data.text || "",
      segments: response.data.segments
        ? response.data.segments.map((segment: any) => ({
            id: segment.id,
            start: segment.start,
            end: segment.end,
            text: segment.text,
            tokens: segment.tokens || [],
            confidence: segment.confidence || 0.9,
          }))
        : [],
    };

    return result;
  } catch (error: any) {
    // Registrar detalles del error para depuración posterior
    try {
      fs.writeFileSync(
        audioFilePath.replace(".wav", "-error.json"),
        JSON.stringify(
          {
            message: error?.message,
            response: error?.response?.data,
          },
          null,
          2
        )
      );
    } catch (e) {
      // Ignorar errores de escritura
    }

    // Propagar el error en lugar de devolver una simulación
    throw error;
  }
}

/**
 * Genera una respuesta simulada para casos de prueba o cuando falla la API
 */
function simulateWhisperResponse(): WhisperTranscriptionResult {
  console.log(
    "[Whisper Simulation] Generando transcripción simulada más realista"
  );

  // Creamos una respuesta simulada con texto más normal/esperado
  const simulatedResponse: WhisperTranscriptionResult = {
    text: "Hola, estoy probando el sistema de transcripción en tiempo real. ¿Cómo funciona?",
    segments: [
      {
        id: 0,
        start: 0.0,
        end: 2.0,
        text: "Hola, estoy probando",
        tokens: [1, 2, 3, 4],
        confidence: 0.95,
      },
      {
        id: 1,
        start: 2.0,
        end: 3.5,
        text: "el sistema de transcripción",
        tokens: [5, 6, 7, 8],
        confidence: 0.92,
      },
      {
        id: 2,
        start: 3.5,
        end: 5.0,
        text: "en tiempo real. ¿Cómo funciona?",
        tokens: [9, 10, 11, 12, 13],
        confidence: 0.9,
      },
    ],
  };

  return simulatedResponse;
}
