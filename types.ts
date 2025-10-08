export type Base64String = string & { readonly _brand: 'base64' };

export interface UploadedImageInfo {
  base64: Base64String;
  mimeType: string;
}

export interface EditResult {
  image: `data:${string};base64,${Base64String}` | null;
  text: string | null;
}

export interface OutfitDetails {
  상의: string;
  하의: string;
  신발: string;
  아우터?: string;
  모자?: string;
  악세서리?: string;
}

export const FASHION_STYLES = [
    '캐주얼', '스트릿', '미니멀', '걸리시', '스포티', '로맨틱', '클래식', '시크', 
    '워크웨어', '시티보이', '고프코어', '레트로', '프레피', '리조트', '에스닉'
] as const;

export type FashionStyle = typeof FASHION_STYLES[number];

// NEW: Represents a season.
export type Season = '봄' | '여름' | '가을' | '겨울';

// NEW: Represents general suggestions (hair, pose) generated based on the user's photo.
export interface GeneralSuggestions {
  '헤어스타일': string[];
  '포즈': string[];
}

// Represents an individual person being styled.
export interface Person {
  id: 1 | 2;
  images: UploadedImageInfo[];
  bodyShape: string;
  height: string;
  ageRange: string;
  personalStyle: string;
}


// This is the existing type for general ideas (fetchStyleIdeas) and reference analysis (analyzeStyleFromImage)
export interface StyleIdeas {
  '코디': (string | OutfitDetails)[];
  '헤어스타일': string[];
  '포즈': string[];
}