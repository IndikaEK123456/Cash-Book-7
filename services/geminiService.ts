
import { GoogleGenAI, Type } from "@google/genai";
import { DEFAULT_LKR_USD, DEFAULT_LKR_EURO } from "../constants";

// Safe API Key access
const getApiKey = () => {
  try {
    // @ts-ignore
    return (typeof process !== 'undefined' && process.env?.API_KEY) || '';
  } catch (e) {
    return '';
  }
};

const ai = new GoogleGenAI({ apiKey: getApiKey() });

export const fetchLiveExchangeRates = async (): Promise<{ usd: number; euro: number }> => {
  const key = getApiKey();
  if (!key) return { usd: DEFAULT_LKR_USD, euro: DEFAULT_LKR_EURO };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Return current exchange rate: 1 USD to LKR, 1 EURO to LKR. JSON only: {usd: number, euro: number}",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            usd: { type: Type.NUMBER },
            euro: { type: Type.NUMBER }
          },
          required: ["usd", "euro"]
        }
      }
    });

    const rates = JSON.parse(response.text);
    return {
      usd: Math.ceil(rates.usd || DEFAULT_LKR_USD),
      euro: Math.ceil(rates.euro || DEFAULT_LKR_EURO)
    };
  } catch (error) {
    return { usd: DEFAULT_LKR_USD, euro: DEFAULT_LKR_EURO };
  }
};
