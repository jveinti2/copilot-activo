import dotenv from "dotenv";
import fs from "fs";
import OpenAI from "openai";
import { OpenAiModels } from "../enums/openai.enum";
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
});
export async function transcribeWithWhisper(audioFilePath: string) {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: OpenAiModels.GPT_4O_TRANSCRIBE,
      language: "es",
      prompt:
        "Transcribe una llamada de servicio al cliente en español colombiano. El cliente puede hablar informalmente, usar muletillas o expresiones comunes. Mantén las palabras tal como las dice, incluso si hay errores gramaticales o frases incompletas.",
    });
    return transcription.text;
  } catch (error: any) {
    console.error("Error transcribiendo el audio:", error?.message);
    throw error;
  }
}

export async function extractQuestionFromTranscription(transcription: string) {
  try {
    const completion = await openai.responses.create({
      model: OpenAiModels.GPT_4O,
      input: transcription,
      instructions: `
        Eres un asistente experto en análisis semántico de textos. Recibes transcripciones largas y desestructuradas.  
        Tu tarea es identificar y extraer la pregunta principal o intención de búsqueda del usuario contenida en la transcripción.  
        - Reformula la pregunta de forma breve, clara, específica y autocontenida, optimizada para búsquedas vectorizadas por similitud de coseno.  
        - Elimina comentarios irrelevantes, explicaciones redundantes o datos que no aporten a la pregunta clave.  
        - Si no hay una pregunta con valor informativo, responde exactamente: "NO PREGUNTA".  
        Devuelve **únicamente** la pregunta formulada o "NO PREGUNTA", sin explicaciones, contexto ni formato adicional.

        Transcripción:
        """${transcription}"""

        Pregunta formulada:`,
      temperature: 0.1,
    });

    return completion.output_text;
  } catch (error: any) {
    console.error("Error extrayendo la pregunta:", error?.message);
    throw error;
  }
}
