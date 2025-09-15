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

export interface StyleIdeas {
  '코디': (string | OutfitDetails)[];
  '헤어스타일': string[];
  '포즈': string[];
}
