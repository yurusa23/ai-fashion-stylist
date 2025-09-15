
import React, { useState, useCallback, useEffect, useRef, useReducer } from 'react';
import ImageUploader from './components/ImageUploader';
import Spinner from './components/Spinner';
import { SparklesIcon, DownloadIcon, ExpandIcon, ShareIcon, RefreshIcon, ContinueIcon, CloseIcon, BackIcon, ChevronDownIcon } from './components/icons';
import { UploadedImageInfo, EditResult, StyleIdeas, OutfitDetails } from './types';
import { editImage, getStyleSuggestions, fetchStyleIdeas, analyzeStyleFromImage } from './services/geminiService';
import ImageModal from './components/ImageModal';
import { logError, logEvent } from './lib/logger';
import ProgressIndicator from './components/ProgressIndicator';

// --- State Management (Reducer) ---
interface AppState {
  portraitImages: UploadedImageInfo[];
  styleReferenceImages: UploadedImageInfo[];
  prompt: string;
  bodyShape: string;
  height: string;
  ageRange: string;
  personalStyle: string;
  
  result: EditResult | null;
  originalImageForDisplay: UploadedImageInfo | null;
  
  // Statuses
  isInfoSaved: boolean;
  appStatus: 'idle' | 'analyzing' | 'generating' | 'success' | 'error';
  isFetchingIdeas: boolean;
  isAnalyzingStyle: boolean;
  error: string | null;

  // Data
  styleIdeas: StyleIdeas | null;
  styleReferenceAnalysis: StyleIdeas | null;
  styleReferenceAnalysisError: string | null;
  isShareSupported: boolean;
}

type AppAction =
  | { type: 'RESET' }
  | { type: 'SET_IMAGES'; payload: UploadedImageInfo[] }
  | { type: 'SET_STYLE_REFERENCE_IMAGES'; payload: UploadedImageInfo[] }
  | { type: 'SET_USER_INFO'; payload: { field: 'bodyShape' | 'height' | 'ageRange' | 'personalStyle' | 'prompt'; value: string } }
  | { type: 'SAVE_INFO_START' }
  | { type: 'SAVE_INFO_SUCCESS' }
  | { type: 'SAVE_INFO_ERROR'; payload: string }
  | { type: 'FETCH_IDEAS_START' }
  | { type: 'FETCH_IDEAS_SUCCESS'; payload: StyleIdeas }
  | { type: 'FETCH_IDEAS_ERROR'; payload: string }
  | { type: 'GENERATE_START'; payload: UploadedImageInfo }
  | { type: 'GENERATE_SUCCESS'; payload: EditResult }
  | { type: 'GENERATE_ERROR'; payload: string }
  | { type: 'CONTINUE_EDITING'; payload: UploadedImageInfo }
  | { type: 'RETURN_TO_PROMPT' }
  | { type: 'ANALYZE_STYLE_START' }
  | { type: 'ANALYZE_STYLE_SUCCESS'; payload: StyleIdeas }
  | { type: 'ANALYZE_STYLE_ERROR'; payload: string }
  | { type: 'CLEAR_STYLE_ANALYSIS' }
  | { type: 'SET_SHARE_SUPPORT'; payload: boolean };


const initialState: AppState = {
  portraitImages: [],
  styleReferenceImages: [],
  prompt: '',
  bodyShape: '',
  height: '',
  ageRange: '',
  personalStyle: '',
  result: null,
  originalImageForDisplay: null,
  isInfoSaved: false,
  appStatus: 'idle',
  isFetchingIdeas: false,
  isAnalyzingStyle: false,
  error: null,
  styleIdeas: null,
  styleReferenceAnalysis: null,
  styleReferenceAnalysisError: null,
  isShareSupported: false,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'RESET':
        return {
            ...initialState,
            isShareSupported: state.isShareSupported,
            styleIdeas: state.styleIdeas // Keep ideas cached
        };
    case 'SET_IMAGES':
      // Reset everything except shared support and cached ideas when a new primary image is set
      return { 
        ...initialState, 
        isShareSupported: state.isShareSupported,
        styleIdeas: state.styleIdeas,
        portraitImages: action.payload 
      };
    case 'SET_STYLE_REFERENCE_IMAGES':
      return { ...state, styleReferenceImages: action.payload };
    case 'SET_USER_INFO':
      return { ...state, [action.payload.field]: action.payload.value };
    case 'SAVE_INFO_START':
      return { ...state, appStatus: 'analyzing', error: null };
    case 'SAVE_INFO_SUCCESS':
      return { ...state, appStatus: 'idle', isInfoSaved: true };
    case 'SAVE_INFO_ERROR':
      return { ...state, appStatus: 'error', error: action.payload };
    case 'FETCH_IDEAS_START':
        return {...state, isFetchingIdeas: true };
    case 'FETCH_IDEAS_SUCCESS':
        return {...state, isFetchingIdeas: false, styleIdeas: action.payload};
    case 'FETCH_IDEAS_ERROR':
        return {...state, isFetchingIdeas: false, error: action.payload};
    case 'GENERATE_START':
        return { ...state, appStatus: 'generating', error: null, result: null, originalImageForDisplay: action.payload };
    case 'GENERATE_SUCCESS':
        return { ...state, appStatus: 'success', result: action.payload };
    case 'GENERATE_ERROR':
        return { ...state, appStatus: 'error', error: action.payload, originalImageForDisplay: null };
    case 'CONTINUE_EDITING':
        return {
            ...state,
            portraitImages: [action.payload],
            styleReferenceImages: [], // Clear reference images for the new edit
            result: null,
            error: null,
            prompt: '',
            appStatus: 'analyzing', // Start analyzing for new suggestions
        };
    case 'RETURN_TO_PROMPT':
        return {
            ...state,
            appStatus: 'idle',
            result: null,
            error: null,
            originalImageForDisplay: state.portraitImages.length > 0 ? state.portraitImages[0] : null,
        };
    case 'ANALYZE_STYLE_START':
        return { ...state, isAnalyzingStyle: true, styleReferenceAnalysis: null, styleReferenceAnalysisError: null, error: null };
    case 'ANALYZE_STYLE_SUCCESS':
        return { ...state, isAnalyzingStyle: false, styleReferenceAnalysis: action.payload, styleReferenceAnalysisError: null };
    case 'ANALYZE_STYLE_ERROR':
        return { ...state, isAnalyzingStyle: false, styleReferenceAnalysis: null, styleReferenceAnalysisError: action.payload };
    case 'CLEAR_STYLE_ANALYSIS':
        return { ...state, isAnalyzingStyle: false, styleReferenceAnalysis: null, styleReferenceAnalysisError: null };
    case 'SET_SHARE_SUPPORT':
        return { ...state, isShareSupported: action.payload };
    default:
      return state;
  }
}

// --- Helper Functions ---
const loadingMessages = [
    'AI가 당신의 사진에 마법을 부리고 있어요...',
    '최고의 스타일을 찾고 있습니다...',
    '잠시만요, 창의력이 폭발하는 중입니다!',
    '디테일을 살려 완벽한 작품을 만드는 중...',
];

const bodyShapeOptions = [ { value: '스트레이트', label: '스트레이트' }, { value: '모래시계', label: '모래시계' }, { value: '서양배', label: '서양배' }, { value: '사과', label: '사과' }, { value: '역삼각형', label: '역삼각형' }];
const ageRangeOptions = [ { value: '10대', label: '10대' }, { value: '20대', label: '20대' }, { value: '30대', label: '30대' }, { value: '40대 이상', label: '40대 이상' }];
const personalStyleOptions = [ { value: '캐주얼', label: '캐주얼' }, { value: '미니멀', label: '미니멀' }, { value: '스트릿', label: '스트릿' }, { value: '포멀', label: '포멀' }, { value: '페미닌', label: '페미닌' }, { value: '빈티지', label: '빈티지' }];

// --- App Component ---
const App: React.FC = () => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>(loadingMessages[0]);
  const [aiSuggestions, setAiSuggestions] = useState<StyleIdeas | null>(null);
  const [activeSuggestionTab, setActiveSuggestionTab] = useState<'ai' | 'ideas'>('ai');
  
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const throttleTimeoutRef = useRef<number | null>(null);

  const {
      portraitImages, styleReferenceImages, prompt, bodyShape, height, ageRange, personalStyle,
      result, originalImageForDisplay, isInfoSaved, appStatus, error,
      styleIdeas, isShareSupported, isFetchingIdeas, isAnalyzingStyle, 
      styleReferenceAnalysis, styleReferenceAnalysisError
  } = state;

  const isLoading = appStatus === 'analyzing' || isFetchingIdeas || appStatus === 'generating' || isAnalyzingStyle;
  const isGenerating = appStatus === 'generating';
  const isAnalyzing = appStatus === 'analyzing';

  useEffect(() => {
    dispatch({ type: 'SET_SHARE_SUPPORT', payload: !!navigator.share });
  }, []);

  const refreshStyleIdeas = useCallback(async (force = false) => {
    if (force) {
        if (throttleTimeoutRef.current) return;
        throttleTimeoutRef.current = window.setTimeout(() => {
            throttleTimeoutRef.current = null;
        }, 1000); // 1 second throttle
    }

    dispatch({type: 'FETCH_IDEAS_START'});
    try {
      const ideas = await fetchStyleIdeas(force);
      dispatch({type: 'FETCH_IDEAS_SUCCESS', payload: ideas});
      logEvent('fetch_style_ideas_success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '스타일 아이디어를 불러오는 데 실패했습니다.';
      logError(err as Error, { context: 'refreshStyleIdeas' });
      dispatch({type: 'FETCH_IDEAS_ERROR', payload: errorMessage});
    }
  }, []);

  // When an image is uploaded, fetch initial trend ideas if they don't exist
  useEffect(() => {
    if (portraitImages.length > 0 && !styleIdeas) {
      refreshStyleIdeas();
    }
  }, [portraitImages, styleIdeas, refreshStyleIdeas]);

  useEffect(() => {
    if (isGenerating) {
      const intervalId = setInterval(() => {
        setLoadingMessage(prev => loadingMessages[(loadingMessages.indexOf(prev) + 1) % loadingMessages.length]);
      }, 2500);
      return () => clearInterval(intervalId);
    }
  }, [isGenerating]);

  const handlePortraitImagesChange = useCallback((images: UploadedImageInfo[]) => {
    dispatch({ type: 'SET_IMAGES', payload: images });
    if (images.length > 0) {
      logEvent('image_uploaded', { count: images.length });
    }
    setAiSuggestions(null); // Clear old suggestions
  }, []);

  const handleStyleReferenceImagesChange = useCallback(async (images: UploadedImageInfo[]) => {
    dispatch({ type: 'SET_STYLE_REFERENCE_IMAGES', payload: images });
    logEvent('style_reference_image_uploaded', { count: images.length });

    if (images.length > 0) {
      dispatch({ type: 'ANALYZE_STYLE_START' });
      try {
        const analysis = await analyzeStyleFromImage(images);
        dispatch({ type: 'ANALYZE_STYLE_SUCCESS', payload: analysis });
        logEvent('style_analysis_success');
      } catch (err) {
        logError(err as Error, { context: 'analyzeStyleFromImage' });
        const errorMessage = err instanceof Error ? err.message : '스타일 분석에 실패했습니다.';
        dispatch({ type: 'ANALYZE_STYLE_ERROR', payload: errorMessage });
      }
    } else {
      dispatch({ type: 'CLEAR_STYLE_ANALYSIS' });
    }
  }, []);

  const fetchAndSetSuggestions = useCallback(async (image: UploadedImageInfo) => {
    try {
      const suggestions = await getStyleSuggestions(image, bodyShape, height, ageRange, personalStyle);
      setAiSuggestions(suggestions);
      dispatch({ type: 'SAVE_INFO_SUCCESS' });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'AI 추천을 생성하는 데 실패했습니다.';
      logError(err as Error, { context: 'fetchAndSetSuggestions' });
      dispatch({ type: 'SAVE_INFO_ERROR', payload: errorMessage });
    }
  }, [bodyShape, height, ageRange, personalStyle]);

  const handleInfoSave = async () => {
    if (portraitImages.length > 0) {
      dispatch({ type: 'SAVE_INFO_START' });
      await fetchAndSetSuggestions(portraitImages[0]);
      setActiveSuggestionTab('ai'); // Switch to AI tab after getting suggestions
      if (promptSectionRef.current) {
        promptSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };
  
  const handleRefreshSuggestions = useCallback(async () => {
      if (portraitImages.length === 0) return;
      
      if (throttleTimeoutRef.current) return;
      throttleTimeoutRef.current = window.setTimeout(() => {
          throttleTimeoutRef.current = null;
      }, 1000); // 1 second throttle

      dispatch({ type: 'SAVE_INFO_START' });
      await fetchAndSetSuggestions(portraitImages[0]);
  }, [portraitImages, fetchAndSetSuggestions, dispatch]);

  const handleGenerateClick = async () => {
    if (portraitImages.length === 0 || !prompt.trim()) {
      dispatch({type: 'GENERATE_ERROR', payload: '사진을 업로드하고 프롬프트를 입력해주세요.'});
      return;
    }
    
    logEvent('generate_start', { prompt_length: prompt.length, reference_image_count: styleReferenceImages.length });
    dispatch({ type: 'GENERATE_START', payload: portraitImages[0] });

    try {
      const editResult = await editImage(portraitImages, styleReferenceImages, prompt, bodyShape, height, ageRange, personalStyle);
      dispatch({ type: 'GENERATE_SUCCESS', payload: editResult });
      logEvent('generate_success');
      if (!editResult.image) {
        logEvent('generate_no_image_result');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      logError(err as Error, { context: 'handleGenerateClick' });
      dispatch({ type: 'GENERATE_ERROR', payload: errorMessage });
    }
  };
  
  const handleContinueEditing = useCallback(() => {
    if (!result?.image) return;

    const [header, base64Data] = result.image.split(',');
    if (!header || !base64Data) {
        dispatch({type: 'GENERATE_ERROR', payload: "이미지 형식이 올바르지 않아 편집을 계속할 수 없습니다."});
        return;
    };
    
    const mimeTypeMatch = header.match(/:(.*?);/);
    if (!mimeTypeMatch?.[1]) {
        dispatch({type: 'GENERATE_ERROR', payload: "이미지 형식이 올바르지 않아 편집을 계속할 수 없습니다."});
        return;
    };

    const newImage: UploadedImageInfo = { base64: base64Data as any, mimeType: mimeTypeMatch[1] };
    
    dispatch({type: 'CONTINUE_EDITING', payload: newImage});
    logEvent('continue_editing');

    // Fetch new suggestions for the newly generated image
    fetchAndSetSuggestions(newImage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [result, fetchAndSetSuggestions]);
  
  const handleReturnToPrompt = useCallback(() => {
    dispatch({ type: 'RETURN_TO_PROMPT' });
    logEvent('return_to_prompt');
    if (promptSectionRef.current) {
        promptSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!result?.image) return;
    const link = document.createElement('a');
    link.href = result.image;
    link.download = `ai_styled_photo_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    logEvent('download_image');
  }, [result]);

  const handleShare = useCallback(async () => {
    if (!result?.image || !isShareSupported) return;
    try {
      const response = await fetch(result.image);
      const blob = await response.blob();
      const file = new File([blob], `ai_styled_photo_${Date.now()}.png`, { type: blob.type });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'AI 패션 스타일리스트',
          text: 'AI로 스타일링한 내 사진을 확인해보세요!',
          files: [file],
        });
        logEvent('share_image_success');
      } else {
         alert("이 브라우저에서는 사진 공유를 지원하지 않습니다.");
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        logError(err as Error, { context: 'handleShare' });
        alert("사진을 공유하는 데 실패했습니다.");
      }
    }
  }, [result, isShareSupported]);

    const currentStep = (() => {
        if (result || appStatus === 'generating' || appStatus === 'success' || appStatus === 'error') return 3;
        if (isInfoSaved) return 2;
        if (portraitImages.length > 0) return 1;
        return 0;
    })();
    const progressSteps = ['사진 업로드', '정보 입력', '스타일 설명', '결과 확인'];

    const renderSuggestionItem = useCallback((item: string | OutfitDetails, type: '코디' | '헤어스타일' | '포즈', index: number) => {
        // Handle simple string suggestions (hair, pose, trend ideas)
        if (typeof item === 'string') {
            return (
                <button
                    key={`${type}-${index}`}
                    onClick={() => {
                        dispatch({ type: 'SET_USER_INFO', payload: { field: 'prompt', value: item } });
                        logEvent('suggestion_clicked', { type, text: item });
                    }}
                    className="w-full text-left p-3 bg-theme-bg/60 rounded-lg hover:bg-theme-accent/10 hover:text-theme-accent transition-colors duration-200 text-sm animate-fade-in-up opacity-0"
                    style={{ animationDelay: `${index * 50}ms` }}
                    aria-label={`프롬프트에 추가: ${item}`}
                >
                    {item}
                </button>
            );
        }

        // Handle detailed outfit suggestions (object)
        const outfitDetails = item as OutfitDetails;
        const fullPromptText = Object.values(outfitDetails).filter(Boolean).join(', ');
        const categoryOrder: (keyof OutfitDetails)[] = ['아우터', '상의', '하의', '신발', '모자', '악세서리'];

        return (
            <div
                key={`${type}-${index}`}
                className="w-full text-left p-3 bg-theme-bg/60 rounded-lg transition-colors duration-200 animate-fade-in-up opacity-0"
                style={{ animationDelay: `${index * 50}ms` }}
            >
                <ul className="space-y-1.5 text-sm">
                    {categoryOrder.map(category => {
                        const value = outfitDetails[category];
                        if (value) {
                            return (
                                <li key={category} className="flex">
                                    <span className="font-semibold w-16 flex-shrink-0 text-theme-gray-dark">{category}</span>
                                    <span className="text-theme-text">{value}</span>
                                </li>
                            );
                        }
                        return null;
                    })}
                </ul>
                <button
                    onClick={() => {
                        dispatch({ type: 'SET_USER_INFO', payload: { field: 'prompt', value: fullPromptText } });
                        logEvent('suggestion_clicked', { type: '코디', text: fullPromptText });
                    }}
                    className="mt-3 w-full text-center text-xs font-semibold text-theme-accent bg-theme-accent/10 py-1.5 px-3 rounded-md hover:bg-theme-accent/20 transition-colors"
                    aria-label={`프롬프트에 전체 코디 추가: ${fullPromptText}`}
                >
                    전체 코디 프롬프트에 추가
                </button>
            </div>
        );
    }, [dispatch]);

    const renderSuggestionCategory = useCallback((title: string, items: (string | OutfitDetails)[] | undefined, type: '코디' | '헤어스타일' | '포즈') => {
        if (!items || items.length === 0) return null;
        return (
            <div className="mb-4">
                <h4 className="text-sm font-bold text-theme-text mb-2">{title}</h4>
                <div className="flex flex-col gap-2">
                    {items.map((item, index) => renderSuggestionItem(item, type, index))}
                </div>
            </div>
        );
    }, [renderSuggestionItem]);
    
    const renderSuggestionsContent = useCallback(() => {
        if (activeSuggestionTab === 'ai') {
            if (isAnalyzing && !aiSuggestions) {
                return <div className="flex items-center justify-center h-full pt-10"><Spinner /></div>;
            }
            const hasSuggestions = aiSuggestions || styleReferenceAnalysis;
            return (
                <div>
                    {!hasSuggestions && <p className="text-sm text-theme-gray-dark text-center py-8">인물 정보 입력 후 'AI 스타일 추천받기'를 클릭하면 맞춤 추천을 볼 수 있어요.</p>}
                    
                    {aiSuggestions && (
                        <div className="animate-fade-in-up">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="font-semibold text-theme-text">내 사진 기반 추천</h3>
                                <button onClick={handleRefreshSuggestions} disabled={isAnalyzing} className="text-sm text-theme-accent hover:underline disabled:opacity-50 flex items-center gap-1"><RefreshIcon className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} /> 새 추천 받기</button>
                            </div>
                            {renderSuggestionCategory('코디', aiSuggestions['코디'], '코디')}
                            {renderSuggestionCategory('헤어스타일', aiSuggestions['헤어스타일'], '헤어스타일')}
                            {renderSuggestionCategory('포즈', aiSuggestions['포즈'], '포즈')}
                        </div>
                    )}

                    {styleReferenceAnalysis && (
                        <div className="mt-6 pt-4 border-t border-theme-gray-light animate-fade-in-up">
                            <h3 className="font-semibold text-theme-text mb-3">참고 이미지 스타일 분석</h3>
                            {renderSuggestionCategory('코디', styleReferenceAnalysis['코디'], '코디')}
                            {renderSuggestionCategory('헤어스타일', styleReferenceAnalysis['헤어스타일'], '헤어스타일')}
                            {renderSuggestionCategory('포즈', styleReferenceAnalysis['포즈'], '포즈')}
                        </div>
                    )}

                    {styleReferenceAnalysisError && (
                        <p className="text-sm text-theme-error mt-4">{styleReferenceAnalysisError}</p>
                    )}
                </div>
            );
        }

        if (activeSuggestionTab === 'ideas') {
            if (isFetchingIdeas && !styleIdeas) { // Show spinner only on initial load
                return <div className="flex items-center justify-center h-full pt-10"><Spinner /></div>;
            }
            return (
                <div className="animate-fade-in-up">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="font-semibold text-theme-text">MUSINSA 트렌드 기반</h3>
                        <button onClick={() => refreshStyleIdeas(true)} disabled={isFetchingIdeas} className="text-sm text-theme-accent hover:underline flex items-center gap-1 disabled:opacity-50"><RefreshIcon className={`w-4 h-4 ${isFetchingIdeas ? 'animate-spin' : ''}`} /> 새로고침</button>
                    </div>
                    {styleIdeas ? (
                        <>
                            {renderSuggestionCategory('코디', styleIdeas['코디'], '코디')}
                            {renderSuggestionCategory('헤어스타일', styleIdeas['헤어스타일'], '헤어스타일')}
                            {renderSuggestionCategory('포즈', styleIdeas['포즈'], '포즈')}
                        </>
                    ) : <p className="text-sm text-theme-gray-dark text-center py-8">최신 트렌드 아이디어를 불러오지 못했습니다.</p>}
                </div>
            );
        }
        return null;
    }, [activeSuggestionTab, isAnalyzing, aiSuggestions, styleReferenceAnalysis, styleReferenceAnalysisError, isFetchingIdeas, styleIdeas, renderSuggestionCategory, handleRefreshSuggestions, refreshStyleIdeas]);


  const renderContent = () => {
    // Result View
    if (appStatus === 'generating' || appStatus === 'success' || appStatus === 'error' || result) {
      return (
        <div className="w-full max-w-2xl mx-auto flex flex-col gap-4 mt-8 animate-slide-in-up">
            <div className="bg-theme-surface backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-4">
                <h2 className="text-xl font-bold text-theme-text mb-4 px-2">결과물</h2>
                <div className="aspect-square w-full bg-black/5 rounded-xl flex items-center justify-center p-2">
                    {isGenerating ? (
                        <div className="relative w-full h-full flex flex-col items-center justify-center text-center rounded-xl overflow-hidden">
                            {originalImageForDisplay ? ( <img src={`data:${originalImageForDisplay.mimeType};base64,${originalImageForDisplay.base64}`} alt="Generating new style" className="absolute inset-0 w-full h-full object-contain blur-sm brightness-75" />) : null}
                            <div className="relative flex flex-col items-center gap-4 text-white bg-black/30 p-6 rounded-lg backdrop-blur-sm"><Spinner className="text-white" /><p className="text-base font-semibold">{loadingMessage}</p></div>
                        </div>
                    ) : error ? ( <p className="text-theme-error text-center p-4">{error}</p>
                    ) : result?.image ? (
                    <div className="w-full h-full relative group animate-rotate-in">
                        <img src={result.image} alt="Generated result" className="w-full h-full object-contain rounded-md" />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 cursor-pointer" onClick={() => setIsModalOpen(true)} role="button" aria-label="View fullscreen"><div className="text-white bg-black/50 p-3 rounded-full pointer-events-none"><ExpandIcon className="w-6 h-6" /></div></div>
                    </div>
                    ) : result?.text ? ( <p className="text-theme-gray-dark text-center px-4 text-base">AI가 이미지를 생성하지 못했습니다. 아래 AI의 설명을 확인하고 프롬프트를 수정하여 다시 시도해 보세요.</p>
                    ) : ( <p className="text-theme-gray-dark text-center text-lg">결과가 여기에 표시됩니다.</p> )}
                </div>
            </div>
            {!isLoading && result?.image && (
                <div className="flex flex-col gap-3 animate-fade-in-up opacity-0" style={{ animationDelay: '200ms' }}>
                    <div className="flex gap-3"><button onClick={handleContinueEditing} className="flex-1 flex items-center justify-center gap-2 bg-theme-accent text-white font-semibold py-3 px-6 rounded-xl shadow-sm hover:bg-theme-accent-hover transition-all duration-200 active:scale-95 text-base" aria-label="이어서 편집하기"><ContinueIcon className="h-5 w-5" /><span>이어서 편집하기</span></button><button onClick={handleReturnToPrompt} className="flex-1 flex items-center justify-center gap-2 bg-theme-surface border border-theme-gray-light text-theme-text font-semibold py-3 px-6 rounded-xl shadow-sm hover:bg-theme-gray-light/50 transition-all duration-200 active:scale-95 text-base" aria-label="스타일 설명으로 돌아가기"><BackIcon className="h-5 w-5" /><span>스타일로 돌아가기</span></button></div>
                    <div className="flex gap-3"><button onClick={handleDownload} className="flex-1 flex items-center justify-center gap-2 bg-theme-surface border border-theme-gray-light text-theme-text font-semibold py-3 px-6 rounded-xl shadow-sm hover:bg-theme-gray-light/50 transition-all duration-200 active:scale-95 text-base" aria-label="이미지 저장"><DownloadIcon className="h-5 w-5" /><span>저장</span></button>{isShareSupported && (<button onClick={handleShare} className="flex-1 flex items-center justify-center gap-2 bg-theme-surface border border-theme-gray-light text-theme-text font-semibold py-3 px-6 rounded-xl shadow-sm hover:bg-theme-gray-light/50 transition-all duration-200 active:scale-95 text-base" aria-label="이미지 공유"><ShareIcon className="h-5 w-5" /><span>공유</span></button>)}</div>
                </div>
            )}
            {result?.text && ( <div className="bg-theme-surface backdrop-blur-xl border border-white/30 p-4 rounded-xl text-sm text-theme-text shadow-soft animate-fade-in-up"><p><span className="font-bold text-theme-accent">AI의 메모:</span> {result.text}</p></div>)}
        </div>
      );
    }
    
    // Upload View
    if (portraitImages.length === 0) {
      return (
         <section className="w-full max-w-2xl mx-auto mt-8 animate-slide-in-up">
            <div className="bg-theme-surface backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-6 md:p-8">
                <h2 className="text-2xl font-bold text-theme-text mb-4 text-center">스타일링 시작하기</h2>
                <p className="text-theme-gray-dark mb-6 text-center">먼저, 스타일을 변경할 인물 사진을 업로드해주세요.</p>
                <div className="aspect-square sm:aspect-[4/3] w-full">
                    <ImageUploader onImagesChange={handlePortraitImagesChange} currentImages={portraitImages} maxImages={5} />
                </div>
            </div>
        </section>
      );
    }

    // Editing View (Info + Prompt)
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 xl:gap-12 mt-8 animate-slide-in-up">
            {/* Left Column: Image Preview */}
            <div className="lg:sticky lg:top-8 self-start">
                 <div className="bg-theme-surface backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-4">
                    <div className="w-full h-full rounded-lg overflow-hidden bg-black/5 ring-1 ring-black/5 shadow-inner relative group aspect-square sm:aspect-[4/3]">
                        <img src={`data:${portraitImages[0].mimeType};base64,${portraitImages[0].base64}`} alt="업로드된 사진 프리뷰" className="w-full h-full object-contain animate-scale-in" />
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" onClick={() => handlePortraitImagesChange([])}>
                            <button className="bg-white text-theme-text font-semibold py-2 px-4 rounded-lg pointer-events-none">사진 변경</button>
                        </div>
                    </div>
                 </div>
            </div>

            {/* Right Column: Controls */}
            <div className="flex flex-col gap-8">
                {/* --- Step 2: User Info --- */}
                <section className="bg-theme-surface backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-6 md:p-8 animate-slide-in-up">
                    <details open={!isInfoSaved}>
                        <summary className="flex items-center justify-between cursor-pointer">
                           <h2 className="text-xl font-bold text-theme-text">인물 정보 입력</h2>
                           <ChevronDownIcon className="w-6 h-6 text-theme-gray-dark transition-transform duration-300" />
                        </summary>
                        <div className="mt-6">
                            <p className="text-theme-gray-dark mb-6 text-sm">더 정확한 스타일 추천을 위해 정보를 입력해주세요. (선택 사항)</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div><label htmlFor="bodyShape" className="block text-sm font-medium text-theme-text mb-1.5">체형</label><select id="bodyShape" value={bodyShape} onChange={(e) => dispatch({type: 'SET_USER_INFO', payload: {field: 'bodyShape', value: e.target.value}})} className="w-full bg-theme-bg/80 border border-theme-gray-light rounded-lg p-3 text-base focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200"><option value="">선택 안함</option>{bodyShapeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                                <div><label htmlFor="height" className="block text-sm font-medium text-theme-text mb-1.5">키 (cm)</label><input id="height" type="number" placeholder="예: 165" value={height} onChange={(e) => dispatch({type: 'SET_USER_INFO', payload: {field: 'height', value: e.target.value}})} className="w-full bg-theme-bg/80 border border-theme-gray-light rounded-lg p-3 text-base focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200" /></div>
                                <div><label htmlFor="ageRange" className="block text-sm font-medium text-theme-text mb-1.5">나이대</label><select id="ageRange" value={ageRange} onChange={(e) => dispatch({type: 'SET_USER_INFO', payload: {field: 'ageRange', value: e.target.value}})} className="w-full bg-theme-bg/80 border border-theme-gray-light rounded-lg p-3 text-base focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200"><option value="">선택 안함</option>{ageRangeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                                <div><label htmlFor="personalStyle" className="block text-sm font-medium text-theme-text mb-1.5">선호 스타일</label><select id="personalStyle" value={personalStyle} onChange={(e) => dispatch({type: 'SET_USER_INFO', payload: {field: 'personalStyle', value: e.target.value}})} className="w-full bg-theme-bg/80 border border-theme-gray-light rounded-lg p-3 text-base focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200"><option value="">선택 안함</option>{personalStyleOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                            </div>
                            <button onClick={handleInfoSave} disabled={appStatus === 'analyzing'} className="mt-6 w-full flex items-center justify-center gap-2 bg-theme-text text-white font-semibold py-3 px-8 rounded-xl shadow-sm hover:bg-theme-text/80 disabled:bg-theme-gray-light disabled:text-theme-gray-dark disabled:cursor-not-allowed transition-all duration-200 active:scale-95">{appStatus === 'analyzing' ? <Spinner /> : 'AI 스타일 추천받기'}</button>
                        </div>
                    </details>
                </section>

                {/* --- Step 3: Prompt & Suggestions --- */}
                {isInfoSaved && (
                    <div ref={promptSectionRef} className="flex flex-col gap-8 animate-slide-in-up" style={{ animationDelay: '150ms'}}>
                        <section className="bg-theme-surface backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-6 md:p-8">
                             <h2 className="text-xl font-bold text-theme-text mb-4">스타일 설명</h2>
                            <div className="relative w-full"><textarea className="w-full bg-theme-bg/80 border-2 border-theme-gray-light rounded-lg p-4 pr-10 placeholder-theme-gray-dark focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200 min-h-[150px] text-base" placeholder="예시: 오버사이즈 그레이 블레이저를 입고 주머니에 손을 넣은 포즈로 바꿔줘." value={prompt} onChange={(e) => dispatch({type: 'SET_USER_INFO', payload: {field: 'prompt', value: e.target.value}})} disabled={isLoading} />{prompt && !isLoading && (<button onClick={() => dispatch({type: 'SET_USER_INFO', payload: {field: 'prompt', value: ''}})} className="absolute top-3 right-3 p-1 text-theme-gray-dark hover:text-theme-text hover:bg-theme-gray-light/50 rounded-full transition-colors duration-200" aria-label="프롬프트 지우기"><CloseIcon className="w-5 h-5" /></button>)}</div>
                            <div className="mt-4"><h3 className="text-base font-semibold text-theme-text mb-2">참고 스타일 이미지 (선택)</h3><p className="text-sm text-theme-gray-dark mb-3">원하는 스타일의 사진을 추가하여 AI에게 더 정확한 요청을 할 수 있습니다. (최대 5장)</p><div className="h-40"><ImageUploader onImagesChange={handleStyleReferenceImagesChange} currentImages={styleReferenceImages} maxImages={5} /></div>{/* Analysis Result Display */}</div>
                            <div className="mt-6"><div className="border-b border-theme-gray-light flex space-x-4"><button onClick={() => setActiveSuggestionTab('ai')} className={`py-2 px-1 text-sm font-semibold transition-colors duration-200 ${ activeSuggestionTab === 'ai' ? 'border-b-2 border-theme-accent text-theme-accent' : 'text-theme-gray-dark hover:text-theme-text'}`}>AI 추천 스타일</button><button onClick={() => setActiveSuggestionTab('ideas')} className={`py-2 px-1 text-sm font-semibold transition-colors duration-200 ${ activeSuggestionTab === 'ideas' ? 'border-b-2 border-theme-accent text-theme-accent' : 'text-theme-gray-dark hover:text-theme-text'}`}>최신 트렌드 아이디어</button></div><div className="pt-4 min-h-[200px]">{renderSuggestionsContent()}</div></div>
                        </section>
                        <button onClick={handleGenerateClick} disabled={isLoading || portraitImages.length === 0 || !prompt} className="w-full flex items-center justify-center gap-3 bg-theme-accent text-white font-bold text-lg py-4 px-6 rounded-xl shadow-medium hover:bg-theme-accent-hover disabled:bg-theme-gray-light disabled:text-theme-gray-dark disabled:cursor-not-allowed transition-all duration-200 active:scale-95">{isGenerating ? (<><Spinner /><span>생성 중...</span></>) : (<><SparklesIcon className="h-6 w-6" /><span>스타일 적용</span></>)}</button>
                    </div>
                )}
            </div>
        </div>
    );
  }
  
  return (
    <>
      <div className="min-h-screen bg-theme-bg text-theme-text font-sans p-4 sm:p-6 md:p-8 overflow-x-hidden">
        <style>{`.transition-all { transition-timing-function: cubic-bezier(0.25, 0.1, 0.25, 1); } details[open] summary ~ * { animation: slideInUp 0.5s ease-out; } details[open] summary svg { transform: rotate(180deg); }`}</style>
        <div className="max-w-7xl mx-auto">
          <header className="text-center mb-10 md:mb-12">
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-theme-text mb-3">
              AI Fashion Stylist
            </h1>
            <p className="mt-4 text-base sm:text-lg text-theme-gray-dark max-w-2xl mx-auto">
              AI와 함께 당신의 사진을 새로운 스타일로 바꿔보세요. 의상, 헤어, 포즈까지 완벽하게.
            </p>
          </header>
            
          <div className="max-w-4xl mx-auto mb-10 md:mb-12 pt-4 pb-8">
            <ProgressIndicator steps={progressSteps} currentStep={currentStep} />
          </div>

          <main className="flex flex-col items-center gap-8 min-h-[60vh]">
            {renderContent()}
          </main>
        </div>
      </div>
      
       {isModalOpen && result?.image && (
        <ImageModal
          imageUrl={result.image}
          onClose={() => setIsModalOpen(false)}
          originalImageUrl={ originalImageForDisplay ? `data:${originalImageForDisplay.mimeType};base64,${originalImageForDisplay.base64}`: null }
        />
      )}
      <footer className="fixed bottom-4 right-4 z-50">
        <p className="text-xs text-theme-gray-dark bg-theme-surface/50 backdrop-blur-sm px-2 py-1 rounded-md shadow-soft">
          제작: SUN HO
        </p>
      </footer>
    </>
  );
};

export default App;
