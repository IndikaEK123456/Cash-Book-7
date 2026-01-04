
import { GoogleGenAI, Type } from "@google/genai";
import { DEFAULT_LKR_USD, DEFAULT_LKR_EURO } from "../constants";

// Bulletproof API Key lookup for Production (Vercel) vs Development (Vite)
const getApiKey = (): string => {
  try {
    // @ts-ignore - Check for Vite-specific env
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_KEY) {
      // @ts-ignore
      return import.meta.env.VITE_API_KEY;
    }
    // @ts-ignore - Check for Node-style env (Vercel)
    if (typeof process !== 'undefined' && process.env?.API_KEY) {
      return process.env.API_KEY;
    }
    return '';
  } catch (e) {
    return '';
  }
};

export const fetchLiveExchangeRates = async (): Promise<{ usd: number; euro: number }> => {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    console.warn("Gemini API Key missing. Using default rates.");
    return { usd: DEFAULT_LKR_USD, euro: DEFAULT_LKR_EURO };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Return the current exchange rate for 1 USD to LKR and 1 EURO to LKR. Response must be JSON only: {usd: number, euro: number}",
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

    const rates = JSON.parse(response.text || "{}");
    return {
      usd: Math.ceil(Number(rates.usd) || DEFAULT_LKR_USD),
      euro: Math.ceil(Number(rates.euro) || DEFAULT_LKR_EURO)
    };
  } catch (error) {
    console.error("Failed to fetch live rates:", error);
    return { usd: DEFAULT_LKR_USD, euro: DEFAULT_LKR_EURO };
  }
};
