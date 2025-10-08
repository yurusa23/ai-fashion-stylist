

// FIX: Updated to use the new @google/genai SDK, including new import paths, API initialization, and generateContent call structures.
import { GoogleGenAI, Modality, Type, GenerateContentResponse } from "@google/genai";
import { EditResult, UploadedImageInfo, StyleIdeas, Base64String, OutfitDetails, FashionStyle, Season, GeneralSuggestions, Person } from '../types';
import { ApiError, SafetyError } from '../lib/errors';

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable is not set");
}

// FIX: Initialize with named apiKey parameter as required by the new SDK.
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
      lastError = error instanceof Error ? error : new Error(String(error));
      
      const isRateLimitError = lastError instanceof Error && (
        lastError.message.includes('"code":429') ||
        lastError.message.includes('RESOURCE_EXHAUSTED')
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

/**
 * Expands a simple user prompt into a more detailed one for image generation.
 * @param prompt The user's input prompt.
 * @returns A promise that resolves to an expanded, detailed prompt string.
 */
export async function expandPrompt(prompt: string): Promise<string> {
  try {
    if (!prompt.trim()) {
      return prompt;
    }
    // FIX: Explicitly type the response to resolve type inference issues.
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `다음 패션 스타일링 요청을 전문적인 이미지 생성 프롬프트로 확장하고 구체화해주세요. 사용자의 핵심 의도는 유지하면서, 의상의 소재, 핏, 색상, 배경, 조명 등 상세한 묘사를 추가하여 풍부한 결과물이 나오도록 만드세요. 결과는 완성된 프롬프트 텍스트만 반환해야 합니다. 다른 설명은 추가하지 마세요.\n\n---\n사용자 요청: "${prompt}"`
    }));
    
    return response.text.trim().replace(/"/g, ''); // Remove quotes from the result
  } catch (error) {
    console.error("Error expanding prompt:", error);
    if (error instanceof Error) throw error;
    throw new ApiError("프롬프트를 확장하는 데 실패했습니다.");
  }
}


/**
 * Generates specific outfit suggestions for a given season and style.
 */
export async function getOutfitSuggestion(
  image: UploadedImageInfo,
  season: Season,
  style: FashionStyle,
  bodyShape: string,
  height: string,
  ageRange: string,
  personalStyle: string
): Promise<OutfitDetails[]> {
  try {
    const details = [];
    if (bodyShape) details.push(`체형이 ${bodyShape}`);
    if (height) details.push(`키가 약 ${height}cm`);
    if (ageRange) details.push(`나이대는 ${ageRange}`);
    if (personalStyle) details.push(`${personalStyle} 스타일을 선호`);

    const personaInfo = details.length > 0
      ? ` 이 인물은 ${details.join(', ')}입니다. 이 특징들을 반드시 고려하여,`
      : '';
          
    const imagePart = {
        inlineData: {
            data: image.base64,
            mimeType: image.mimeType,
        },
    };

    const prompt = `이 이미지 속 인물을 분석해주세요.${personaInfo} ${season}에 어울리는 ${style} 스타일의 서로 다른 패셔너블한 코디를 3개 추천해주세요. 특히, 제공된 체형 정보를 적극적으로 활용하여 체형의 장점을 부각시키고 단점을 보완하는 스타일링을 제안해야 합니다. 각 코디는 '상의', '하의', '신발'과 선택적으로 '아우터', '모자', '악세서리'로 구성된 상세 정보 객체여야 합니다. 각 항목에는 구체적인 아이템과 색상 조합을 포함시켜주세요. 제안은 간결하고 창의적이어야 하며, 이미지 생성 모델의 프롬프트로 바로 사용할 수 있어야 합니다. 현재 입고 있는 옷에 대한 설명은 피해주세요. 결과를 JSON 배열 형식으로 반환해주세요.`;

    // FIX: Explicitly type the response to resolve type inference issues.
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: { parts: [{ text: prompt }, imagePart] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        '상의': { type: Type.STRING },
                        '하의': { type: Type.STRING },
                        '신발': { type: Type.STRING },
                        '아우터': { type: Type.STRING },
                        '모자': { type: Type.STRING },
                        '악세서리': { type: Type.STRING },
                    },
                    required: ['상의', '하의', '신발']
                }
            }
        },
    }));

    const jsonStr = response.text.trim();
    const outfits = JSON.parse(jsonStr);
    
    if (!Array.isArray(outfits) || outfits.length === 0 || outfits.some(outfit => typeof outfit !== 'object' || outfit === null || !outfit['상의'] || !outfit['하의'] || !outfit['신발'])) {
        throw new Error('AI가 유효한 형식의 코디 추천 배열을 반환하지 않았습니다.');
    }

    return outfits as OutfitDetails[];

  } catch (error) {
    console.error("Error getting outfit suggestion:", error);
    if (error instanceof Error) throw error;
    throw new ApiError("코디 제안을 가져오는 데 실패했습니다.");
  }
}

/**
 * Generates general suggestions like hairstyle and poses.
 */
export async function getGeneralSuggestions(
  image: UploadedImageInfo,
  bodyShape: string,
  height: string,
  ageRange: string,
  personalStyle: string
): Promise<GeneralSuggestions> {
  try {
    const details = [];
    if (bodyShape) details.push(`체형이 ${bodyShape}`);
    if (height) details.push(`키가 약 ${height}cm`);
    if (ageRange) details.push(`나이대는 ${ageRange}`);
    if (personalStyle) details.push(`${personalStyle} 스타일을 선호`);

    const personaInfo = details.length > 0
      ? ` 이 인물은 ${details.join(', ')}입니다. 이 특징들을 반드시 고려하여,`
      : '';

    const imagePart = {
        inlineData: {
            data: image.base64,
            mimeType: image.mimeType,
        },
    };

    const prompt = `이 이미지 속 인물을 분석해주세요.${personaInfo} 어울릴 만한 패셔너블한 스타일 아이디어를 제안해주세요. 특히, 제공된 체형 정보를 적극적으로 활용하여 체형의 장점을 부각시키는 헤어스타일과 포즈를 추천해야 합니다. 아이디어는 '헤어스타일', '포즈' 카테고리로 나누어주세요. '헤어스타일'과 '포즈'는 각각 2~3개의 아이디어를 문자열 배열로 제안해주세요. 제안은 간결하고 창의적이어야 하며, 이미지 생성 모델의 프롬프트로 바로 사용할 수 있어야 합니다. 현재 입고 있는 옷에 대한 설명은 피해주세요. 결과를 JSON 형식으로 반환해주세요.`;

    // FIX: Explicitly type the response to resolve type inference issues.
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: { parts: [{ text: prompt }, imagePart] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    '헤어스타일': { type: Type.ARRAY, items: { type: Type.STRING } },
                    '포즈': { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ['헤어스타일', '포즈']
            }
        },
    }));

    const jsonStr = response.text.trim();
    const suggestions = JSON.parse(jsonStr);
    
    if (typeof suggestions !== 'object' || suggestions === null || !suggestions['헤어스타일'] || !suggestions['포즈']) {
        throw new Error('AI가 유효한 형식의 스타일 추천을 반환하지 않았습니다.');
    }

    return suggestions as GeneralSuggestions;

  } catch (error) {
    console.error("Error getting general suggestions:", error);
    if (error instanceof Error) throw error;
    throw new ApiError("스타일 제안을 가져오는 데 실패했습니다.");
  }
}

/**
 * Generates hairstyle suggestions.
 */
export async function getHairstyleSuggestions(
  image: UploadedImageInfo,
  bodyShape: string,
  height: string,
  ageRange: string,
  personalStyle: string
): Promise<{ '헤어스타일': string[] }> {
  try {
    const details = [];
    if (bodyShape) details.push(`체형이 ${bodyShape}`);
    if (height) details.push(`키가 약 ${height}cm`);
    if (ageRange) details.push(`나이대는 ${ageRange}`);
    if (personalStyle) details.push(`${personalStyle} 스타일을 선호`);

    const personaInfo = details.length > 0
      ? ` 이 인물은 ${details.join(', ')}입니다. 이 특징들을 반드시 고려하여,`
      : '';
      
    const imagePart = {
        inlineData: {
            data: image.base64,
            mimeType: image.mimeType,
        },
    };

    const prompt = `이 이미지 속 인물을 분석해주세요.${personaInfo} 어울릴 만한 패셔너블한 '헤어스타일' 아이디어를 2~3개 제안해주세요. 특히, 제공된 체형 정보를 적극적으로 활용하여 얼굴형과 전체적인 실루엣에 어울리는 스타일을 추천해야 합니다. 제안은 간결하고 창의적이어야 하며, 이미지 생성 모델의 프롬프트로 바로 사용할 수 있어야 합니다. 현재 입고 있는 옷에 대한 설명은 피해주세요. 결과를 JSON 형식으로 반환해주세요.`;

    // FIX: Explicitly type the response to resolve type inference issues.
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: { parts: [{ text: prompt }, imagePart] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    '헤어스타일': { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ['헤어스타일']
            }
        },
    }));

    const jsonStr = response.text.trim();
    const suggestions = JSON.parse(jsonStr);
    
    if (typeof suggestions !== 'object' || suggestions === null || !suggestions['헤어스타일']) {
        throw new Error('AI가 유효한 형식의 헤어스타일 추천을 반환하지 않았습니다.');
    }

    return suggestions as { '헤어스타일': string[] };

  } catch (error) {
    console.error("Error getting hairstyle suggestions:", error);
    if (error instanceof Error) throw error;
    throw new ApiError("헤어스타일 제안을 가져오는 데 실패했습니다.");
  }
}

/**
 * Generates pose suggestions.
 */
export async function getPoseSuggestions(
  image: UploadedImageInfo,
  bodyShape: string,
  height: string,
  ageRange: string,
  personalStyle: string
): Promise<{ '포즈': string[] }> {
  try {
    const details = [];
    if (bodyShape) details.push(`체형이 ${bodyShape}`);
    if (height) details.push(`키가 약 ${height}cm`);
    if (ageRange) details.push(`나이대는 ${ageRange}`);
    if (personalStyle) details.push(`${personalStyle} 스타일을 선호`);

    const personaInfo = details.length > 0
      ? ` 이 인물은 ${details.join(', ')}입니다. 이 특징들을 반드시 고려하여,`
      : '';
      
    const imagePart = {
        inlineData: {
            data: image.base64,
            mimeType: image.mimeType,
        },
    };

    const prompt = `이 이미지 속 인물을 분석해주세요.${personaInfo} 어울릴 만한 패셔너블한 '포즈' 아이디어를 2~3개 제안해주세요. 특히, 제공된 체형 정보를 적극적으로 활용하여 체형의 장점을 가장 잘 보여줄 수 있는 포즈를 추천해야 합니다. 제안은 간결하고 창의적이어야 하며, 이미지 생성 모델의 프롬프트로 바로 사용할 수 있어야 합니다. 현재 입고 있는 옷에 대한 설명은 피해주세요. 결과를 JSON 형식으로 반환해주세요.`;

    // FIX: Explicitly type the response to resolve type inference issues.
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: { parts: [{ text: prompt }, imagePart] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    '포즈': { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ['포즈']
            }
        },
    }));

    const jsonStr = response.text.trim();
    const suggestions = JSON.parse(jsonStr);
    
    if (typeof suggestions !== 'object' || suggestions === null || !suggestions['포즈']) {
        throw new Error('AI가 유효한 형식의 포즈 추천을 반환하지 않았습니다.');
    }

    return suggestions as { '포즈': string[] };

  } catch (error) {
    console.error("Error getting pose suggestions:", error);
    if (error instanceof Error) throw error;
    throw new ApiError("포즈 제안을 가져오는 데 실패했습니다.");
  }
}

export async function analyzeStyleFromImage(images: UploadedImageInfo[]): Promise<StyleIdeas> {
  if (images.length === 0) {
    throw new Error("No images provided for style analysis.");
  }
  
  try {
    const imageParts = images.map(image => ({
      inlineData: {
        data: image.base64,
        mimeType: image.mimeType,
      },
    }));

    const prompt = `이 이미지(들)에 나타난 패션 스타일을 분석해주세요. '헤어스타일', '포즈', '코디' 세 가지 카테고리로 나누어 설명해야 합니다. '헤어스타일'과 '포즈'는 각각 1~2개의 키워드를 문자열 배열로 제안해주세요. '코디' 카테고리에서는 보이는 의상을 분석하여 1~2개의 착장을 설명해야 합니다. 각 착장은 '상의', '하의', '신발'과 보이는 경우 '아우터', '모자', '악세서리'로 구성된 객체여야 합니다. 각 항목에는 의상의 스타일, 주요 색상, 전체적인 분위기를 포함하여 구체적으로 설명해주세요. 모든 제안은 이미지 생성 프롬프트로 바로 사용할 수 있도록 간결해야 합니다. 결과를 JSON 형식으로 반환해주세요.`;

    // FIX: Explicitly type the response to resolve type inference issues.
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: { parts: [{ text: prompt }, ...imageParts] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    '코디': {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                '상의': { type: Type.STRING },
                                '하의': { type: Type.STRING },
                                '신발': { type: Type.STRING },
                                '아우터': { type: Type.STRING },
                                '모자': { type: Type.STRING },
                                '악세서리': { type: Type.STRING },
                            },
                            required: ['상의', '하의', '신발']
                        }
                    },
                    '헤어스타일': {
                        type: Type.ARRAY,
                        items: { type: Type.STRING }
                    },
                    '포즈': {
                        type: Type.ARRAY,
                        items: { type: Type.STRING }
                    }
                },
                required: ['코디', '헤어스타일', '포즈']
            }
        },
    }));
    
    const jsonStr = response.text.trim();
    const suggestions = JSON.parse(jsonStr);

    if (typeof suggestions !== 'object' || suggestions === null || !suggestions['코디'] || !suggestions['헤어스타일'] || !suggestions['포즈']) {
        throw new Error('AI가 유효한 형식의 스타일 분석을 반환하지 않았습니다.');
    }

    return suggestions as StyleIdeas;

  } catch (error) {
    console.error("Error analyzing style from image:", error);
    if (error instanceof Error) throw error;
    throw new ApiError("참고 이미지의 스타일을 분석하는 데 실패했습니다.");
  }
}

export async function editImage(
  people: Person[],
  styleReferenceImages: UploadedImageInfo[],
  prompt: string,
  negativePrompt: string,
  cameraComposition: 'keep' | 'recompose'
): Promise<EditResult> {
  try {
    const portraitImageParts = people.flatMap(p => p.images.map(image => ({
        inlineData: {
            data: image.base64,
            mimeType: image.mimeType,
        },
    })));

    const styleReferenceImageParts = styleReferenceImages.map(image => ({
        inlineData: {
            data: image.base64,
            mimeType: image.mimeType,
        },
    }));
    
    const referenceImageInstruction = styleReferenceImages.length > 0
        ? " 이어지는 참고 이미지(들)의 스타일을 반영하고,"
        : "";
    
    const blockReferenceImageReturnInstruction = styleReferenceImages.length > 0
        ? " **매우 중요**: 당신의 임무는 새로운 이미지를 창조하는 것입니다. 입력으로 받은 참고용 스타일 이미지를 그대로 또는 거의 그대로 반환하는 것은 '실패'로 간주됩니다. 절대 참고 이미지를 복사하지 마세요. 인물의 얼굴과 체형은 유지하되, 스타일, 의상, 배경 등은 프롬프트에 따라 완전히 새롭게 구성해야 합니다. 결과물은 완전히 새로운 창작물이어야 합니다."
        : " 결과물은 반드시 '새롭게 생성된' 이미지여야 합니다.";
        
    const compositionInstruction = cameraComposition === 'recompose'
      ? "사진의 구도를 더 매력적이고 역동적인 새로운 앵글로 자유롭게 재구성해주세요."
      : "기존 사진의 카메라 앵글, 프레이밍, 구도를 그대로 유지해주세요.";
      
    const highQualityInstruction = "결과물은 스튜디오에서 촬영한 것처럼 매우 사실적이고 전문적인 최고 품질의 사진이어야 합니다.";

    const negativePromptInstruction = negativePrompt.trim()
      ? `\n\n중요: 다음 요소들은 결과물에 절대 포함되지 않도록 제외해주세요: "${negativePrompt.trim()}".`
      : "";

    let personaInfo = '';
    let engineeredPrompt = '';

    if (people.length > 1) { // Multi-person scenario
        const personaInfos = people.map((p, index) => {
            const details = [];
            if (p.bodyShape) details.push(`체형이 ${p.bodyShape}`);
            if (p.height) details.push(`키가 약 ${p.height}cm`);
            if (p.ageRange) details.push(`나이대는 ${p.ageRange}`);
            if (p.personalStyle) details.push(`${p.personalStyle} 스타일 선호`);
            if (details.length > 0) {
                return `참고로, ${index + 1}번 인물은 ${details.join(', ')}입니다.`;
            }
            return '';
        }).filter(Boolean).join(' ');
        
        personaInfo = `${personaInfos} 이 정보들을 반드시 반영하여 이미지를 생성해주세요.`;
        
        engineeredPrompt = `두 명의 인물 사진이 제공됩니다. 첫 번째 이미지 세트는 1번 인물, 두 번째 이미지 세트는 2번 인물입니다. 이 두 인물의 얼굴과 체형을 유지하면서, 하나의 새로운 이미지로 조합해주세요.${referenceImageInstruction} 아래 사용자 요청에 따라 이미지를 생성해주세요. ${compositionInstruction} ${highQualityInstruction} ${blockReferenceImageReturnInstruction} 당신의 주된 임무는 텍스트 설명이나 거절 메시지 없이, 요청을 최대한 해석하여 이미지를 편집하고 생성하는 것입니다. ${personaInfo}\n\n---\n사용자 요청: "${prompt}"${negativePromptInstruction}`;

    } else if (people.length === 1) { // Single person
        const p = people[0];
        const details = [];
        if (p.bodyShape) details.push(`체형이 ${p.bodyShape}`);
        if (p.height) details.push(`키가 약 ${p.height}cm`);
        if (p.ageRange) details.push(`나이대는 ${p.ageRange}`);
        if (p.personalStyle) details.push(`${p.personalStyle} 스타일 선호`);
        
        personaInfo = details.length > 0
          ? `참고로, 사진 속 인물은 ${details.join(', ')}입니다. 이 정보를 반드시 반영하여 체형의 장점을 살리는 방향으로 이미지를 생성해주세요.`
          : '';

        engineeredPrompt = `제공된 인물 사진의 얼굴과 체형을 유지하면서,${referenceImageInstruction} 아래 사용자 요청에 따라 새로운 이미지를 생성해주세요. ${compositionInstruction} ${highQualityInstruction} ${blockReferenceImageReturnInstruction} 당신의 주된 임무는 텍스트 설명이나 거절 메시지 없이, 요청을 최대한 해석하여 이미지를 편집하고 생성하는 것입니다. ${personaInfo}\n\n---\n사용자 요청: "${prompt}"${negativePromptInstruction}`;
    } else {
        throw new Error("No people provided for image editing.");
    }
    
    const allParts = [
      ...portraitImageParts, // Subject image(s) first to establish context
      ...styleReferenceImageParts, // Style reference image(s) second
      { text: engineeredPrompt }
    ];
    
    // FIX: Explicitly type the response to resolve type inference issues.
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: allParts },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        }
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

    const editResult: EditResult = { image: null, text: null };
    for (const part of candidate.content.parts) {
      if (part.text) {
        editResult.text = part.text;
      } else if (part.inlineData) {
        const base64ImageBytes = part.inlineData.data as Base64String;
        const imageMimeType = part.inlineData.mimeType;
        editResult.image = `data:${imageMimeType};base64,${base64ImageBytes}`;
      }
    }

    if (!editResult.image && !editResult.text) {
      throw new ApiError("AI로부터 이미지나 텍스트를 포함한 응답을 받지 못했습니다. 다시 시도해 주세요.");
    }

    return editResult;
  } catch (error) {
    console.error("Error editing image with Gemini:", error);
    
    // If it's already one of our custom, user-facing errors, re-throw it directly.
    if (error instanceof ApiError || error instanceof SafetyError) {
      throw error;
    }

    // For other generic errors from the SDK or elsewhere, try to provide a more helpful message.
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('400') && (message.includes('invalid') || message.includes('bad request'))) {
        throw new ApiError("AI가 요청을 이해하지 못했습니다. 프롬프트가 너무 복잡하거나 업로드한 이미지가 부적절할 수 있습니다. 프롬프트를 단순화하거나 다른 이미지를 사용해 보세요.");
      }
      if (message.includes('500') || message.includes('503') || message.includes('server error') || message.includes('unavailable')) {
        throw new ApiError("AI 서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      }
    }

    // Fallback for truly unknown errors, but with better advice.
    throw new ApiError("알 수 없는 오류로 이미지 생성에 실패했습니다. 네트워크 연결을 확인하고, 프롬프트를 조금 수정하여 다시 시도해 보세요.");
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
    const prompt = `당신은 최신 패션 트렌드 전문가입니다. 온라인 패션 스토어(예: https://www.musinsa.com/main/musinsa/recommend?gf=A)를 참고하여, 현재 유행하는 여성 패션 아이디어를 생성해주세요. 아이디어는 '코디', '헤어스타일', '포즈' 세 가지 카테고리로 나누어, 각 카테고리별로 3~4개의 독창적이고 중복되지 않는 아이디어를 문자열로 제안해야 합니다. '코디' 아이디어는 완전한 착장을 설명하는 하나의 문장이어야 합니다. 결과는 반드시 JSON 형식으로 반환해주세요.`;

    // FIX: Add a responseSchema to ensure the AI returns a predictable JSON structure, preventing rendering errors.
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    '코디': { type: Type.ARRAY, items: { type: Type.STRING } },
                    '헤어스타일': { type: Type.ARRAY, items: { type: Type.STRING } },
                    '포즈': { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ['코디', '헤어스타일', '포즈']
            }
        },
    }));
    
    const jsonStr = response.text.trim();
    const ideas = JSON.parse(jsonStr);
    
    // FIX: Stricter validation to ensure '코디' is an array of strings, matching the new schema.
    if (
      typeof ideas !== 'object' || ideas === null ||
      !Array.isArray(ideas['코디']) ||
      !Array.isArray(ideas['헤어스타일']) ||
      !Array.isArray(ideas['포즈']) ||
      ideas['코디'].some((item: unknown) => typeof item !== 'string')
    ) {
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