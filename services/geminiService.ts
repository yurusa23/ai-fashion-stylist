// FIX: Add GenerateContentResponse to import to correctly type API responses.
import { GoogleGenAI, Modality, Type, GenerateContentResponse } from "@google/genai";
import { EditResult, UploadedImageInfo, StyleIdeas, Base64String } from '../types';
import { ApiError, SafetyError } from '../lib/errors';

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * A utility function to retry an async operation with exponential backoff.
 * This is used to handle API rate limiting (429 errors).
 * @param apiCall The async function to call.
 * @param maxRetries Maximum number of retries.
 * @param initialDelay The initial delay in milliseconds.
 * @returns A promise that resolves with the result of the apiCall.
 */
async function withRetry<T>(
  apiCall: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 1000
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      lastError = error as Error;
      // Check for a specific rate limit error code (429) or status.
      const isRateLimitError = error instanceof Error && (
        error.message.includes('"code":429') ||
        error.message.includes('RESOURCE_EXHAUSTED')
      );

      if (isRateLimitError) {
        if (attempt === maxRetries - 1) {
            // Last attempt failed, break the loop and throw below.
            break;
        }
        // Calculate delay with exponential backoff and jitter
        const delay = initialDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.warn(
          `Rate limit exceeded. Retrying in ${Math.round(delay / 1000)}s... (Attempt ${attempt + 1}/${maxRetries})`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Not a retryable error, throw it immediately.
        throw error;
      }
    }
  }
  
  // If all retries failed, throw a more informative, user-friendly error.
  throw new ApiError(`API 요청이 많아 일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해주세요.`);
}


export async function getStyleSuggestions(
  image: UploadedImageInfo,
  bodyShape: string,
  height: string,
  ageRange: string,
  personalStyle: string
): Promise<string[]> {
  try {
    const details = [];
    if (bodyShape) details.push(`체형이 ${bodyShape}`);
    if (height) details.push(`키가 약 ${height}cm`);
    if (ageRange) details.push(`나이대는 ${ageRange}`);
    if (personalStyle) details.push(`${personalStyle} 스타일을 선호`);

    const personaInfo = details.length > 0
      ? ` 이 인물은 ${details.join(', ')}입니다. 이 특징들을 반드시 고려하여,`
      : '';

    // FIX: Explicitly type the API response to resolve 'unknown' type errors.
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              data: image.base64,
              mimeType: image.mimeType,
            },
          },
          {
            text: `이 이미지 속 인물을 분석해주세요.${personaInfo} 어울릴 만한 패셔너블한 의상 아이디어 4가지를 제안해주세요. 제안은 간결하고 창의적이어야 하며, 이미지 생성 모델의 프롬프트로 바로 사용할 수 있어야 합니다. 현재 입고 있는 옷에 대한 설명은 피해주세요. 결과를 JSON 문자열 배열 형태로 제공해주세요. 예: ["클래식한 트렌치 코트와 스트라이프 스웨터, 다크 워시 진 코디", "화사한 플로럴 프린트 선드레스와 스트랩 샌들 코디", ...]`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
          },
        },
      },
    }));

    const jsonStr = response.text.trim();
    const suggestions = JSON.parse(jsonStr);
    if (!Array.isArray(suggestions) || !suggestions.every(s => typeof s === 'string')) {
        console.error('AI did not return a valid array of strings.', suggestions);
        return [];
    }
    return suggestions;

  } catch (error) {
    console.error("Error getting style suggestions:", error);
    if (error instanceof Error) throw error;
    throw new ApiError("스타일 제안을 가져오는 데 실패했습니다.");
  }
}


export async function editImage(
  portraitImages: UploadedImageInfo[],
  prompt: string,
  bodyShape: string,
  height: string,
  ageRange: string,
  personalStyle: string
): Promise<EditResult> {
  try {
    const imageParts = portraitImages.map(image => ({
        inlineData: {
            data: image.base64,
            mimeType: image.mimeType,
        },
    }));

    const details = [];
    if (bodyShape) details.push(`체형이 ${bodyShape}`);
    if (height) details.push(`키가 약 ${height}cm`);
    if (ageRange) details.push(`나이대는 ${ageRange}`);
    if (personalStyle) details.push(`${personalStyle} 스타일 선호`);

    const personaInfo = details.length > 0
      ? `참고로, 사진 속 인물은 ${details.join(', ')}입니다. 이 정보를 반영하여 이미지를 생성해주세요.`
      : '';

    const engineeredPrompt = `주어진 인물 사진을 아래 요청에 따라 수정해주세요. ${personaInfo} 결과물은 반드시 수정된 이미지여야 합니다.\n\n---\n사용자 요청: "${prompt}"`;
    
    // FIX: Explicitly type the API response to resolve 'unknown' type errors.
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
      model: 'gemini-2.5-flash-image-preview',
      contents: {
        parts: [
          ...imageParts,
          {
            text: engineeredPrompt,
          },
        ],
      },
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    }));

    // 1. Check for prompt-level blocks first (user's input issue).
    if (response.promptFeedback?.blockReason) {
       throw new SafetyError(`요청하신 내용(이미지 또는 프롬프트)이 Google의 안전 정책을 위반하여 처리할 수 없습니다. 이미지를 바꾸거나 '아름다운'과 같은 긍정적인 형용사를 사용하여 프롬프트를 더 순화하여 다시 시도해 보세요.`);
    }

    const candidate = response.candidates?.[0];

    // 2. Check if there are any candidates. No candidates might mean the response itself was blocked.
    if (!candidate) {
        throw new SafetyError("AI가 생성한 결과가 Google의 안전 정책에 따라 차단되었습니다. 이는 생성 과정에서 의도치 않게 발생할 수 있습니다. 프롬프트를 좀 더 구체적으로 작성하거나(예: '파티 드레스' 대신 '반짝이는 파란색 칵테일 드레스'), 다른 스타일을 요청하여 AI가 더 안전한 이미지를 생성하도록 유도해 보세요.");
    }
    
    // 3. Check the finish reason of the candidate for issues during generation (AI's output issue).
    const finishReason = candidate.finishReason;
    if (finishReason && finishReason !== 'STOP') {
        switch (finishReason) {
            case 'SAFETY':
            case 'PROHIBITED_CONTENT':
                 throw new SafetyError("AI가 생성한 결과가 Google의 안전 정책에 따라 차단되었습니다. 이는 생성 과정에서 의도치 않게 발생할 수 있습니다. 프롬프트를 좀 더 구체적으로 작성하거나(예: '파티 드레스' 대신 '반짝이는 파란색 칵테일 드레스'), 다른 스타일을 요청하여 AI가 더 안전한 이미지를 생성하도록 유도해 보세요.");
            case 'RECITATION':
                throw new SafetyError("AI가 저작권 보호 자료와 유사한 콘텐츠를 생성하여 요청이 차단되었습니다. 프롬프트를 수정해 주세요.");
            case 'MAX_TOKENS':
                throw new ApiError("요청이 너무 길어 AI가 응답을 완료할 수 없습니다. 프롬프트를 줄여주세요.");
            case 'OTHER':
            default:
                throw new ApiError(`알 수 없는 이유로 이미지 생성에 실패했습니다. (코드: ${finishReason})`);
        }
    }

    // 4. Check if the candidate has content parts.
    if (!candidate.content?.parts || candidate.content.parts.length === 0) {
      throw new ApiError("AI로부터 유효한 응답을 받지 못했습니다. 다시 시도해 주세요.");
    }

    const result: EditResult = { image: null, text: null };
    for (const part of candidate.content.parts) {
      if (part.text) {
        result.text = part.text;
      } else if (part.inlineData) {
        const base64ImageBytes = part.inlineData.data as Base64String;
        const imageMimeType = part.inlineData.mimeType;
        result.image = `data:${imageMimeType};base64,${base64ImageBytes}`;
      }
    }

    if (!result.image && !result.text) {
      throw new ApiError("AI로부터 이미지나 텍스트를 포함한 응답을 받지 못했습니다. 다시 시도해 주세요.");
    }

    return result;
  } catch (error) {
    console.error("Error editing image with Gemini:", error);
    if (error instanceof Error) throw error; // Re-throw custom errors
    throw new ApiError("알 수 없는 오류로 이미지 생성에 실패했습니다.");
  }
}

const STYLE_IDEAS_CACHE_KEY = 'styleIdeasCache';
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

export async function fetchStyleIdeas(forceRefresh = false): Promise<StyleIdeas> {
  // Check cache first
  if (!forceRefresh) {
    const cachedItem = sessionStorage.getItem(STYLE_IDEAS_CACHE_KEY);
    if (cachedItem) {
      try {
        const { timestamp, data } = JSON.parse(cachedItem);
        if (Date.now() - timestamp < CACHE_DURATION) {
          return data as StyleIdeas;
        }
      } catch (e) {
        console.error("Failed to parse style ideas from cache", e);
        sessionStorage.removeItem(STYLE_IDEAS_CACHE_KEY);
      }
    }
  }

  try {
    // FIX: Explicitly type the API response to resolve 'unknown' type errors.
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            text: `당신은 최신 패션 트렌드 전문가입니다. 온라인 패션 스토어(예: https://www.musinsa.com/main/musinsa/recommend?gf=A)를 참고하여, 현재 유행하는 여성 패션 아이디어를 생성해주세요. 아이디어는 '코디', '헤어스타일', '포즈' 세 가지 카테고리로 나누어, 각 카테고리별로 3~4개의 독창적이고 중복되지 않는 아이디어를 제안해야 합니다. 결과는 반드시 지정된 JSON 형식으로 반환해주세요.`,
          },
        ],
      },
      config: {
        temperature: 1, // Add temperature for more creative, non-repetitive results
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            '코디': {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "최신 유행하는 여성 코디 스타일 3~4개. (예: '로우라이즈 카고 팬츠와 크롭탑을 매치한 Y2K 스타일')",
            },
            '헤어스타일': {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "현재 인기 있는 헤어스타일 3~4개. (예: '자연스러운 컬의 중단발 빌드펌')",
            },
            '포즈': {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "사진 촬영 시 참고할 만한 자연스러운 포즈 3~4개. (예: '벽에 살짝 기대어 다리를 꼬고 서 있는 포즈')",
            },
          },
          required: ['코디', '헤어스타일', '포즈'],
        },
      },
    }));

    const jsonStr = response.text.trim();
    const ideas = JSON.parse(jsonStr);
    
    if (typeof ideas !== 'object' || ideas === null || !ideas['코디'] || !ideas['헤어스타일'] || !ideas['포즈']) {
        throw new Error('AI가 유효한 형식의 스타일 아이디어를 반환하지 않았습니다.');
    }

    // Save to cache
    const cacheItem = {
      timestamp: Date.now(),
      data: ideas,
    };
    sessionStorage.setItem(STYLE_IDEAS_CACHE_KEY, JSON.stringify(cacheItem));
    
    return ideas as StyleIdeas;

  } catch (error) {
    console.error("Error fetching style ideas:", error);
    throw new ApiError("최신 스타일 아이디어를 불러오는 데 실패했습니다.");
  }
}