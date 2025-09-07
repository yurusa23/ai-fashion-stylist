export type Base64String = string & { readonly _brand: 'base64' };

export interface UploadedImageInfo {
  base64: Base64String;
  mimeType: string;
}

export interface EditResult {
  image: `data:${string};base64,${Base64String}` | null;
  text: string | null;
}

export interface StyleIdeas {
  [category: string]: string[];
}
