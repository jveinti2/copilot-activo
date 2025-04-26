import axios from "axios";
import dotenv from "dotenv";
import FormData from "form-data";
import https from "https";

dotenv.config();

const httpAgent = new https.Agent({ rejectUnauthorized: false });
const URL_RFP_GURU =
  process.env["URL_RFP_GURU"] || "https://api.rfp.guru/v1/ask";
const RFP_GURU_API_KEY = process.env["RFP_GURU_API_KEY"] || "your-api-key-here";

export async function getResponseGuru(text: string) {
  const formData = new FormData();
  formData.append("name", "haceb");
  formData.append("question", text);

  const response = await axios.post(URL_RFP_GURU, formData, {
    headers: {
      ...formData.getHeaders(),
      "x-api-key": `${RFP_GURU_API_KEY}`,
    },
    httpsAgent: httpAgent,
  });

  return response.data;
}
