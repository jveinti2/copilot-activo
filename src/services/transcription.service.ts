import axios from "axios";
import dotenv from "dotenv";
import FormData from "form-data";
import fs from "fs";
import { Configuration, OpenAIApi } from "openai";

// Configuración básica
dotenv.config();

const OPENAI_API_KEY = process.env["OPENAI_API_KEY"] || "";
console.log(
  "Estado API KEY:",
  OPENAI_API_KEY ? "Configurada ✅" : "No configurada ❌"
);

if (!OPENAI_API_KEY) {
  console.warn(
    "⚠️ No se ha configurado OPENAI_API_KEY en las variables de entorno."
  );
}

const configuration = new Configuration({
  apiKey: OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Tipos de datos
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

// Función principal para transcribir audio
export async function transcribeWithWhisper(
  audioFilePath: string
): Promise<WhisperTranscriptionResult> {
  if (!OPENAI_API_KEY) {
    throw new Error(
      "No se ha configurado OPENAI_API_KEY en las variables de entorno"
    );
  }

  try {
    const formData = new FormData();
    const fileBuffer = fs.readFileSync(audioFilePath);

    formData.append("file", fileBuffer, {
      filename: "audio.wav",
      contentType: "audio/wav",
    });

    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    formData.append("language", "es");

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
        timeout: 30000,
      }
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

    throw error;
  }
}
