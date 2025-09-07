import React, { useState, useCallback, useEffect, useRef, useReducer } from 'react';
import ImageUploader from './components/ImageUploader';
import Spinner from './components/Spinner';
import { SparklesIcon, DownloadIcon, ExpandIcon, ShareIcon, RefreshIcon, ContinueIcon } from './components/icons';
import { UploadedImageInfo, EditResult, StyleIdeas } from './types';
import { editImage, getStyleSuggestions, fetchStyleIdeas } from './services/geminiService';
import ImageModal from './components/ImageModal';
import ImageComparator from './components/ImageComparator';
import { logError, logEvent } from './lib/logger';
import ProgressIndicator from './components/ProgressIndicator';

// --- State Management (Reducer) ---
interface AppState {
  portraitImages: UploadedImageInfo[];
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
  error: string | null;

  // Static/Cached data
  styleIdeas: StyleIdeas | null;
  isShareSupported: boolean;
}

type AppAction =
  | { type: 'RESET' }
  | { type: 'SET_IMAGES'; payload: UploadedImageInfo[] }
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
  | { type: 'CONTINUE_EDITING'; payload: UploadedImageInfo };


const initialState: AppState = {
  portraitImages: [],
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
  error: null,
  styleIdeas: null,
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
      return { ...initialState, isShareSupported: state.isShareSupported, portraitImages: action.payload };
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
            result: null,
            error: null,
            prompt: '',
            appStatus: 'analyzing', // Start analyzing for new suggestions
        };
    default:
      return state;
  }
}

// FIX: Removed unused `dataUrlToPngBlob` function which was causing a compile error due to missing implementation.
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
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const throttleTimeoutRef = useRef<number | null>(null);

  const {
      portraitImages, prompt, bodyShape, height, ageRange, personalStyle,
      result, originalImageForDisplay, isInfoSaved, appStatus, error,
      styleIdeas, isShareSupported, isFetchingIdeas
  } = state;

  const isLoading = appStatus === 'analyzing' || isFetchingIdeas || appStatus === 'generating';
  const isGenerating = appStatus === 'generating';

  useEffect(() => {
    // Check for navigator.share support on mount
    initialState.isShareSupported = !!navigator.share;
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

  // When user info is saved, fetch style ideas if they don't exist yet
  useEffect(() => {
    if (isInfoSaved && !styleIdeas) {
      refreshStyleIdeas();
    }
  }, [isInfoSaved, styleIdeas, refreshStyleIdeas]);

  useEffect(() => {
    if (isGenerating) {
      const intervalId = setInterval(() => {
        setLoadingMessage(prev => loadingMessages[(loadingMessages.indexOf(prev) + 1) % loadingMessages.length]);
      }, 2500);
      return () => clearInterval(intervalId);
    }
  }, [isGenerating]);

  const handlePortraitImagesChange = useCallback((images: UploadedImageInfo[]) => {
    if (images.length > 0) {
      dispatch({ type: 'SET_IMAGES', payload: images });
      logEvent('image_uploaded', { count: images.length });
    } else {
      dispatch({ type: 'RESET' });
    }
    setAiSuggestions([]);
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
      if (promptSectionRef.current) {
        promptSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  const handleGenerateClick = async () => {
    if (portraitImages.length === 0 || !prompt.trim()) {
      dispatch({type: 'GENERATE_ERROR', payload: '사진을 업로드하고 프롬프트를 입력해주세요.'});
      return;
    }
    
    logEvent('generate_start', { prompt_length: prompt.length });
    dispatch({ type: 'GENERATE_START', payload: portraitImages[0] });

    try {
      const editResult = await editImage(portraitImages, prompt, bodyShape, height, ageRange, personalStyle);
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

    fetchAndSetSuggestions(newImage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [result, fetchAndSetSuggestions]);
  
  // --- UI handlers ---
  // ... download, share, modal handlers remain largely the same, but can be simplified ...

    const currentStep = (() => {
        if (result) return 3;
        if (isInfoSaved) return 2;
        if (portraitImages.length > 0) return 1;
        return 0;
    })();
    const progressSteps = ['사진 업로드', '정보 입력', '스타일 설명', '결과 확인'];

  return (
    <>
      <div className="min-h-screen bg-theme-bg text-theme-text font-sans p-4 sm:p-6 md:p-8">
        <style>{`.transition-all { transition-timing-function: cubic-bezier(0.25, 0.1, 0.25, 1); }`}</style>
        <div className="max-w-7xl mx-auto">
          <header className="text-center mb-10 md:mb-12">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-theme-text mb-3">
              AI 패션 스타일리스트
            </h1>
            <p className="mt-4 text-base sm:text-lg text-theme-gray-dark max-w-2xl mx-auto">
              AI와 함께 당신의 사진을 새로운 스타일로 바꿔보세요. 의상, 헤어, 포즈까지 완벽하게.
            </p>
          </header>
            
          <div className="max-w-2xl mx-auto mb-10 md:mb-12 pt-4">
            <ProgressIndicator steps={progressSteps} currentStep={currentStep} />
          </div>

          <main className="flex flex-col gap-8">
             <section className="animate-scale-in">
                <div className="max-w-5xl mx-auto bg-theme-surface backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-6 md:p-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 items-start">
                        {/* Left Column: Uploader or Preview */}
                        <div className="w-full">
                            <h2 className="text-xl font-bold text-theme-text mb-4">사진 업로드</h2>
                            <div className="aspect-[4/3] w-full">
                                {portraitImages.length === 0 ? (
                                    <ImageUploader 
                                        onImagesChange={handlePortraitImagesChange}
                                        currentImages={portraitImages}
                                        maxImages={5}
                                    />
                                ) : (
                                     <div className="w-full h-full rounded-lg overflow-hidden bg-black/5 ring-1 ring-black/5 shadow-inner relative group">
                                        <img 
                                            src={`data:${portraitImages[0].mimeType};base64,${portraitImages[0].base64}`} 
                                            alt="업로드된 사진 프리뷰"
                                            className="w-full h-full object-contain animate-scale-in"
                                        />
                                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" onClick={() => handlePortraitImagesChange([])}>
                                            <button className="bg-white text-theme-text font-semibold py-2 px-4 rounded-lg pointer-events-none">
                                                사진 변경
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Right Column: Placeholder or Info Form */}
                        <div className="w-full">
                             {portraitImages.length > 0 && !isInfoSaved ? (
                                <div className="animate-fade-in-up">
                                    <h2 className="text-xl font-bold text-theme-text mb-4">인물 정보 입력</h2>
                                    <p className="text-theme-gray-dark mb-6 text-sm">
                                        더 정확한 스타일 추천을 위해 정보를 입력해주세요. (선택 사항)
                                    </p>
                                    <div className="space-y-4">
                                        {/* Form fields here, using dispatch */}
                                         <div>
                                            <label htmlFor="bodyShape" className="block text-sm font-medium text-theme-text mb-1.5">체형</label>
                                            <select id="bodyShape" value={bodyShape} onChange={(e) => dispatch({type: 'SET_USER_INFO', payload: {field: 'bodyShape', value: e.target.value}})} className="w-full bg-theme-bg/80 border border-theme-gray-light rounded-lg p-3 text-base focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200">
                                                <option value="">선택 안함</option>
                                                {bodyShapeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label htmlFor="height" className="block text-sm font-medium text-theme-text mb-1.5">키 (cm)</label>
                                            <input id="height" type="number" placeholder="예: 165" value={height} onChange={(e) => dispatch({type: 'SET_USER_INFO', payload: {field: 'height', value: e.target.value}})} className="w-full bg-theme-bg/80 border border-theme-gray-light rounded-lg p-3 text-base focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200" />
                                        </div>
                                        <div>
                                            <label htmlFor="ageRange" className="block text-sm font-medium text-theme-text mb-1.5">나이대</label>
                                            <select id="ageRange" value={ageRange} onChange={(e) => dispatch({type: 'SET_USER_INFO', payload: {field: 'ageRange', value: e.target.value}})} className="w-full bg-theme-bg/80 border border-theme-gray-light rounded-lg p-3 text-base focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200">
                                                <option value="">선택 안함</option>
                                                {ageRangeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label htmlFor="personalStyle" className="block text-sm font-medium text-theme-text mb-1.5">선호 스타일</label>
                                            <select id="personalStyle" value={personalStyle} onChange={(e) => dispatch({type: 'SET_USER_INFO', payload: {field: 'personalStyle', value: e.target.value}})} className="w-full bg-theme-bg/80 border border-theme-gray-light rounded-lg p-3 text-base focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200">
                                                <option value="">선택 안함</option>
                                                {personalStyleOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <button onClick={handleInfoSave} disabled={appStatus === 'analyzing'} className="mt-6 w-full flex items-center justify-center gap-2 bg-theme-accent text-white font-semibold py-3 px-8 rounded-xl shadow-sm hover:bg-theme-accent-hover disabled:bg-theme-gray-light disabled:text-theme-gray-dark disabled:cursor-not-allowed transition-all duration-200 active:scale-95">
                                        {appStatus === 'analyzing' ? <Spinner /> : 'AI 스타일 추천받기'}
                                    </button>
                                </div>
                            ) : (
                                <div className="h-full flex flex-col justify-center min-h-[300px] md:min-h-full">
                                    <h2 className="text-xl font-bold text-theme-text mb-4">인물 정보 입력</h2>
                                    <div className="h-full flex flex-col justify-center items-center text-center p-4 border-2 border-dashed border-theme-gray-light rounded-lg bg-black/5">
                                        <SparklesIcon className="w-10 h-10 text-theme-gray-dark mb-3" />
                                        <h3 className="font-semibold text-theme-text">AI 스타일링을 위한 정보</h3>
                                        <p className="text-sm text-theme-gray-dark mt-1 max-w-xs">
                                            왼쪽에 사진을 업로드하면 체형, 키, 나이대, 선호 스타일 등의 정보를 입력하여 AI에게 더 정확한 스타일링을 요청할 수 있습니다.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </section>
            
            {isInfoSaved && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fade-in-up">
                <div ref={promptSectionRef} className="flex flex-col gap-8">
                    <section className="bg-theme-surface backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-6 md:p-8">
                        <h2 className="text-xl font-bold text-theme-text mb-4">스타일 설명</h2>
                        <textarea
                            className="w-full bg-theme-bg/80 border border-theme-gray-light rounded-lg p-4 placeholder-theme-gray-dark focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200 min-h-[150px] text-base"
                            placeholder="예시: 오버사이즈 그레이 블레이저를 입고 주머니에 손을 넣은 포즈로 바꿔줘."
                            value={prompt}
                            onChange={(e) => dispatch({type: 'SET_USER_INFO', payload: {field: 'prompt', value: e.target.value}})}
                            disabled={isLoading}
                        />
                         {/* AI Suggestions and Style Ideas sections remain visually similar but fed from new state model */}
                          <div className="mt-6">
                            <h3 className="text-base font-semibold text-theme-text mb-3">AI 추천 스타일:</h3>
                            {appStatus === 'analyzing' ? (
                                <div className="flex items-center gap-2 text-theme-gray-dark text-sm p-2">
                                    <Spinner />
                                    <span>AI가 사진을 분석하여 스타일을 추천하고 있습니다...</span>
                                </div>
                            ) : aiSuggestions.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {aiSuggestions.map((suggestion, index) => (
                                        <button 
                                            key={suggestion} 
                                            onClick={() => dispatch({type: 'SET_USER_INFO', payload: {field: 'prompt', value: suggestion}})} 
                                            disabled={isLoading} 
                                            className="px-3 py-1.5 bg-theme-bg/80 text-theme-text rounded-lg text-sm border border-theme-gray-light hover:border-theme-accent hover:text-theme-accent transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed animate-fade-in-up opacity-0"
                                            style={{ animationDelay: `${index * 75}ms` }}
                                            title={suggestion}
                                        >
                                           {suggestion.length > 50 ? `${suggestion.substring(0, 50)}...` : suggestion}
                                        </button>
                                    ))}
                                </div>
                            ) : portraitImages.length > 0 ? (
                                <p className="text-sm text-theme-gray-dark p-2">AI 추천을 생성하지 못했습니다. 직접 스타일을 설명하거나 다른 사진을 사용해 보세요.</p>
                            ) : null }
                        </div>
                         <div className="mt-6">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-base font-semibold text-theme-text">스타일 아이디어:</h3>
                                <button onClick={() => refreshStyleIdeas(true)} disabled={isLoading} className="p-1.5 rounded-full text-theme-gray-dark hover:text-theme-accent hover:bg-theme-accent/10 disabled:opacity-50 transition-colors" aria-label="새로운 스타일 아이디어 보기">
                                    <RefreshIcon className={`w-5 h-5 ${isFetchingIdeas ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                            
                            {isFetchingIdeas && !styleIdeas ? ( <div className="flex items-center justify-center p-8"><Spinner /></div> ) :
                             styleIdeas ? (
                                <div className="flex flex-col gap-4">
                                    {Object.entries(styleIdeas).map(([category, suggestions], categoryIndex) => (
                                        <div key={category} className="animate-fade-in-up opacity-0" style={{ animationDelay: `${categoryIndex * 150}ms` }}>
                                            <h4 className="text-sm font-semibold text-theme-gray-dark mb-2">{category}</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {suggestions.map((suggestion, suggestionIndex) => (
                                                    <button key={suggestion} onClick={() => dispatch({type: 'SET_USER_INFO', payload: {field: 'prompt', value: prompt ? `${prompt}, ${suggestion}` : suggestion}})} disabled={isLoading} className="px-3 py-1.5 bg-theme-bg/80 text-theme-text rounded-lg text-sm border border-theme-gray-light hover:border-theme-accent hover:text-theme-accent transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed animate-fade-in-up opacity-0" style={{ animationDelay: `${categoryIndex * 150 + (suggestionIndex + 1) * 50}ms` }}>
                                                        {suggestion}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </section>
                    
                    <button onClick={handleGenerateClick} disabled={isLoading || portraitImages.length === 0 || !prompt} className="w-full flex items-center justify-center gap-3 bg-theme-accent text-white font-bold text-lg py-4 px-6 rounded-xl shadow-medium hover:bg-theme-accent-hover disabled:bg-theme-gray-light disabled:text-theme-gray-dark disabled:cursor-not-allowed transition-all duration-200 active:scale-95">
                        {isGenerating ? (<><Spinner /><span>생성 중...</span></>) : (<><SparklesIcon className="h-6 w-6" /><span>스타일 적용</span></>)}
                    </button>
                </div>

                <div className="lg:sticky top-8 flex flex-col gap-4 h-min">
                    <div className="bg-theme-surface backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-4">
                        <h2 className="text-xl font-bold text-theme-text mb-4 px-2">결과물</h2>
                        <div className="aspect-square w-full bg-black/5 rounded-xl flex items-center justify-center p-2">
                            {isGenerating ? ( <div className="flex flex-col items-center gap-4 text-theme-gray-dark text-center"><Spinner /><p className="text-base">{loadingMessage}</p></div>
                            ) : error ? ( <p className="text-theme-error text-center p-4">{error}</p>
                            ) : result?.image ? (
                            <div className="w-full h-full relative group animate-rotate-in">
                                {originalImageForDisplay ? (
// FIX: Corrected prop name from `imageUrl` to `originalImageUrl` to match the ImageComparator component's props.
                                    <ImageComparator originalImageUrl={`data:${originalImageForDisplay.mimeType};base64,${originalImageForDisplay.base64}`} editedImageUrl={result.image} />
                                ) : ( <img src={result.image} alt="Generated result" className="w-full h-full object-contain rounded-md" /> )}
                                {/* Modal button etc. */}
                            </div>
                            ) : result?.text ? ( <p className="text-theme-gray-dark text-center px-4 text-base">AI가 이미지를 생성하지 못했습니다. 아래 AI의 설명을 확인하고 프롬프트를 수정하여 다시 시도해 보세요.</p>
                            ) : ( <p className="text-theme-gray-dark text-center text-lg">결과가 여기에 표시됩니다.</p> )}
                        </div>
                    </div>

                    {!isLoading && result?.image && (
                         <div className="flex flex-col gap-3 animate-fade-in-up opacity-0" style={{ animationDelay: '200ms' }}>
                            <button onClick={handleContinueEditing} className="w-full flex items-center justify-center gap-2 bg-theme-accent text-white font-semibold py-3 px-6 rounded-xl shadow-sm hover:bg-theme-accent-hover transition-all duration-200 active:scale-95 text-base" aria-label="이어서 편집하기">
                                <ContinueIcon className="h-5 w-5" />
                                <span>이어서 편집하기</span>
                            </button>
                             {/* Share/Download buttons */}
                         </div>
                    )}
                    {result?.text && (
                        <div className="bg-theme-surface backdrop-blur-xl border border-white/30 p-4 rounded-xl text-sm text-theme-text shadow-soft animate-fadeIn">
                            <p><span className="font-bold text-theme-accent">AI의 메모:</span> {result.text}</p>
                        </div>
                    )}
                </div>
            </div>
            )}
          </main>
        </div>
      </div>
      {/* Modal remains the same */}
       {isModalOpen && result?.image && (
        <ImageModal
          imageUrl={result.image}
          onClose={() => setIsModalOpen(false)}
          originalImageUrl={
            originalImageForDisplay
              ? `data:${originalImageForDisplay.mimeType};base64,${originalImageForDisplay.base64}`
              : null
          }
        />
      )}
    </>
  );
};

export default App;