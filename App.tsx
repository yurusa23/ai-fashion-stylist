
import React, { useState, useCallback, useEffect, useRef, useReducer } from 'react';
import ImageUploader from './components/ImageUploader';
import Spinner from './components/Spinner';
import { SparklesIcon, DownloadIcon, ExpandIcon, ShareIcon, RefreshIcon, ContinueIcon, CloseIcon, BackIcon, ChevronDownIcon, FrameIcon } from './components/icons';
import { UploadedImageInfo, EditResult, StyleIdeas, OutfitDetails, GeneralSuggestions, Season, FASHION_STYLES, FashionStyle, Person } from './types';
import { editImage, getGeneralSuggestions, getOutfitSuggestion, fetchStyleIdeas, analyzeStyleFromImage, getHairstyleSuggestions, getPoseSuggestions, expandPrompt } from './services/geminiService';
import ImageModal from './components/ImageModal';
import { logError, logEvent } from './lib/logger';
import ProgressIndicator from './components/ProgressIndicator';

// --- State Management (Reducer) ---

// NEW: Defines the structure for a saved generation history item.
interface GenerationHistoryItem {
  result: EditResult;
  originalImage: UploadedImageInfo | null;
  prompt: string;
  negativePrompt: string;
  cameraComposition: 'keep' | 'recompose';
}

interface AppState {
  numberOfPeople: 1 | 2;
  people: Person[];
  selectedPersonId: 1 | 2;
  combineInOneImage: boolean;
  appStep: 'upload' | 'info' | 'result';

  styleReferenceImages: UploadedImageInfo[];
  prompt: string;
  negativePrompt: string;
  cameraComposition: 'keep' | 'recompose';
  
  result: EditResult | null;
  originalImageForDisplay: UploadedImageInfo | null;
  
  // Statuses
  isInfoSaved: boolean;
  generatingStatus: 'idle' | 'generating' | 'success' | 'error';
  isFetchingIdeas: boolean;
  isAnalyzingStyle: boolean;
  isExpandingPrompt: boolean;
  error: string | null;

  // Data
  styleIdeas: StyleIdeas | null;
  styleReferenceAnalysis: StyleIdeas | null;
  styleReferenceAnalysisError: string | null;
  isShareSupported: boolean;

  // NEW: Holds the history of generated images for the current session.
  generationHistory: GenerationHistoryItem[];
}

type AppAction =
  | { type: 'RESET' }
  | { type: 'SET_NUMBER_OF_PEOPLE'; payload: 1 | 2 }
  | { type: 'SET_PERSON_IMAGES'; payload: { personId: 1 | 2; images: UploadedImageInfo[] } }
  | { type: 'SET_STYLE_REFERENCE_IMAGES'; payload: UploadedImageInfo[] }
  | { type: 'SET_PROMPT_INFO'; payload: { field: 'prompt' | 'negativePrompt'; value: string } }
  | { type: 'SET_PERSON_INFO'; payload: { personId: 1 | 2; field: keyof Omit<Person, 'id' | 'images'>; value: string } }
  | { type: 'SET_APP_STEP'; payload: 'upload' | 'info' | 'result' }
  | { type: 'SET_SELECTED_PERSON_ID', payload: 1 | 2 }
  | { type: 'TOGGLE_COMBINE_IN_ONE_IMAGE' }
  | { type: 'FETCH_IDEAS_START' }
  | { type: 'FETCH_IDEAS_SUCCESS'; payload: StyleIdeas }
  | { type: 'FETCH_IDEAS_ERROR'; payload: string }
  | { type: 'EXPAND_PROMPT_START' }
  | { type: 'EXPAND_PROMPT_SUCCESS'; payload: string }
  | { type: 'EXPAND_PROMPT_ERROR'; payload: string }
  | { type: 'GENERATE_START'; payload: UploadedImageInfo }
  | { type: 'GENERATE_SUCCESS'; payload: EditResult }
  | { type: 'GENERATE_ERROR'; payload: string }
  | { type: 'RETURN_TO_INFO' }
  | { type: 'CONTINUE_EDITING'; payload: UploadedImageInfo }
  | { type: 'ANALYZE_STYLE_START' }
  | { type: 'ANALYZE_STYLE_SUCCESS'; payload: StyleIdeas }
  | { type: 'ANALYZE_STYLE_ERROR'; payload: string }
  | { type: 'CLEAR_STYLE_ANALYSIS' }
  | { type: 'SET_CAMERA_COMPOSITION'; payload: 'keep' | 'recompose' }
  | { type: 'SET_SHARE_SUPPORT'; payload: boolean }
  | { type: 'SAVE_INFO_SUCCESS' }
  // NEW: Action to load a previous result from the history gallery.
  | { type: 'LOAD_FROM_HISTORY'; payload: GenerationHistoryItem };


const initialPersonState = (id: 1 | 2): Person => ({
  id,
  images: [],
  bodyShape: '',
  height: '',
  ageRange: '',
  personalStyle: '',
});

const initialState: AppState = {
  numberOfPeople: 1,
  people: [initialPersonState(1), initialPersonState(2)],
  selectedPersonId: 1,
  combineInOneImage: false,
  appStep: 'upload',

  styleReferenceImages: [],
  prompt: '',
  negativePrompt: '',
  cameraComposition: 'keep',
  result: null,
  originalImageForDisplay: null,
  isInfoSaved: false,
  generatingStatus: 'idle',
  isFetchingIdeas: false,
  isAnalyzingStyle: false,
  isExpandingPrompt: false,
  error: null,
  styleIdeas: null,
  styleReferenceAnalysis: null,
  styleReferenceAnalysisError: null,
  isShareSupported: false,
  generationHistory: [], // NEW: Initialize history as an empty array.
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'RESET':
        return {
            ...initialState,
            isShareSupported: state.isShareSupported,
            styleIdeas: state.styleIdeas // Keep ideas cached
        };
    case 'SET_NUMBER_OF_PEOPLE':
        return {
            ...state,
            numberOfPeople: action.payload,
            // Reset people data if number of people changes
            people: [initialPersonState(1), initialPersonState(2)],
            isInfoSaved: false,
        };
    case 'SET_PERSON_IMAGES':
      return {
        ...state,
        people: state.people.map(p =>
          p.id === action.payload.personId ? { ...p, images: action.payload.images } : p
        ),
        isInfoSaved: false,
      };
    case 'SET_STYLE_REFERENCE_IMAGES':
      return { ...state, styleReferenceImages: action.payload };
    case 'SET_PROMPT_INFO':
      return { ...state, [action.payload.field]: action.payload.value };
    case 'SET_PERSON_INFO':
        return {
            ...state,
            people: state.people.map(p =>
                p.id === action.payload.personId ? { ...p, [action.payload.field]: action.payload.value } : p
            ),
            isInfoSaved: false, // Info changed, needs to be re-saved
        };
    case 'SET_APP_STEP':
        return { ...state, appStep: action.payload };
    case 'SET_SELECTED_PERSON_ID':
        return { ...state, selectedPersonId: action.payload };
    case 'TOGGLE_COMBINE_IN_ONE_IMAGE':
        return { ...state, combineInOneImage: !state.combineInOneImage };
    case 'SAVE_INFO_SUCCESS':
        return { ...state, generatingStatus: 'idle', isInfoSaved: true };
    case 'FETCH_IDEAS_START':
        return {...state, isFetchingIdeas: true };
    case 'FETCH_IDEAS_SUCCESS':
        return {...state, isFetchingIdeas: false, styleIdeas: action.payload};
    case 'FETCH_IDEAS_ERROR':
        return {...state, isFetchingIdeas: false, error: action.payload};
    case 'EXPAND_PROMPT_START':
        return { ...state, isExpandingPrompt: true, error: null };
    case 'EXPAND_PROMPT_SUCCESS':
        return { ...state, isExpandingPrompt: false, prompt: action.payload };
    case 'EXPAND_PROMPT_ERROR':
        // Keep the original prompt on error
        return { ...state, isExpandingPrompt: false, error: action.payload };
    case 'GENERATE_START':
        return { ...state, generatingStatus: 'generating', appStep: 'result', error: null, result: null, originalImageForDisplay: action.payload };
    case 'GENERATE_SUCCESS': {
        // NEW: When a generation is successful, create a history item and add it to the state.
        const newHistoryItem: GenerationHistoryItem | null = action.payload.image ? {
            result: action.payload,
            originalImage: state.originalImageForDisplay,
            prompt: state.prompt,
            negativePrompt: state.negativePrompt,
            cameraComposition: state.cameraComposition,
        } : null;

        return {
            ...state,
            generatingStatus: 'success',
            result: action.payload,
            generationHistory: newHistoryItem 
                ? [newHistoryItem, ...state.generationHistory]
                : state.generationHistory,
        };
    }
    case 'GENERATE_ERROR':
        return { ...state, generatingStatus: 'error', appStep: 'result', error: action.payload, originalImageForDisplay: null };
    case 'RETURN_TO_INFO':
        return {
            ...state,
            appStep: 'info',
            generatingStatus: 'idle',
            error: null,
        };
    case 'CONTINUE_EDITING':
        return {
            ...initialState,
            appStep: 'info',
            numberOfPeople: 1,
            people: [{ ...initialPersonState(1), images: [action.payload] }, initialPersonState(2)],
            isShareSupported: state.isShareSupported,
            styleIdeas: state.styleIdeas,
            prompt: state.prompt,
            // Keep history from the previous session
            generationHistory: state.generationHistory,
        };
    case 'ANALYZE_STYLE_START':
        return { ...state, isAnalyzingStyle: true, styleReferenceAnalysis: null, styleReferenceAnalysisError: null, error: null };
    case 'ANALYZE_STYLE_SUCCESS':
        return { ...state, isAnalyzingStyle: false, styleReferenceAnalysis: action.payload, styleReferenceAnalysisError: null };
    case 'ANALYZE_STYLE_ERROR':
        return { ...state, isAnalyzingStyle: false, styleReferenceAnalysis: null, styleReferenceAnalysisError: action.payload };
    case 'CLEAR_STYLE_ANALYSIS':
        return { ...state, isAnalyzingStyle: false, styleReferenceAnalysis: null, styleReferenceAnalysisError: null };
    case 'SET_CAMERA_COMPOSITION':
        return { ...state, cameraComposition: action.payload };
    case 'SET_SHARE_SUPPORT':
        return { ...state, isShareSupported: action.payload };
    // NEW: Handles loading a past result from the history gallery into the main view.
    case 'LOAD_FROM_HISTORY':
        return {
            ...state,
            result: action.payload.result,
            originalImageForDisplay: action.payload.originalImage,
            prompt: action.payload.prompt,
            negativePrompt: action.payload.negativePrompt,
            cameraComposition: action.payload.cameraComposition,
            error: null,
            generatingStatus: 'success', // Show it as a valid, loaded result
        };
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

const SEASONS: Season[] = ['봄', '여름', '가을', '겨울'];
const bodyShapeOptions = [
    { value: '일자형', label: '일자형 (어깨-허리-골반 폭이 비슷)' },
    { value: '모래시계형', label: '모래시계형 (잘록한 허리)' },
    { value: '삼각형', label: '삼각형 (상체보다 하체가 발달)' },
    { value: '원형', label: '원형 (복부를 중심으로 상체가 발달)' },
    { value: '역삼각형', label: '역삼각형 (하체보다 어깨가 발달)' }
];
const ageRangeOptions = [ { value: '10대', label: '10대' }, { value: '20대', label: '20대' }, { value: '30대', label: '30대' }, { value: '40대 이상', label: '40대 이상' }];
const personalStyleOptions = [ { value: '캐주얼', label: '캐주얼' }, { value: '미니멀', label: '미니멀' }, { value: '스트릿', label: '스트릿' }, { value: '포멀', label: '포멀' }, { value: '페미닌', label: '페미닌' }, { value: '빈티지', label: '빈티지' }];

type OutfitSuggestionState = Partial<Record<Season, Partial<Record<FashionStyle, OutfitDetails[] | 'loading' | 'error' | string>>>>;


// --- App Component ---
const App: React.FC = () => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>(loadingMessages[0]);
  
  // State for AI suggestions (keyed by person ID)
  const [generalSuggestions, setGeneralSuggestions] = useState<Record<1 | 2, GeneralSuggestions | null>>({ 1: null, 2: null });
  const [outfitSuggestions, setOutfitSuggestions] = useState<Record<1 | 2, OutfitSuggestionState>>({ 1: {}, 2: {} });
  
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [isRefreshingSuggestions, setIsRefreshingSuggestions] = useState({
    hairstyle: false,
    pose: false,
  });
  const [openOutfitStyle, setOpenOutfitStyle] = useState<FashionStyle | null>(null);


  const [activeSuggestionTab, setActiveSuggestionTab] = useState<'ai' | 'ideas'>('ai');
  
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const throttleTimeoutRef = useRef<number | null>(null);

  const {
      numberOfPeople, people, selectedPersonId, combineInOneImage, appStep,
      styleReferenceImages, prompt, negativePrompt, cameraComposition,
      result, originalImageForDisplay, isInfoSaved, generatingStatus, error,
      styleIdeas, isShareSupported, isFetchingIdeas, isAnalyzingStyle, isExpandingPrompt,
      styleReferenceAnalysis, styleReferenceAnalysisError,
      generationHistory // NEW: Destructure history from state.
  } = state;
  
  const selectedPerson = people.find(p => p.id === selectedPersonId)!;
  const activePeople = people.slice(0, numberOfPeople).filter(p => p.images.length > 0);

  const isLoading = generatingStatus === 'generating' || isFetchingIdeas || isAnalyzingStyle || isExpandingPrompt;
  const isGenerating = generatingStatus === 'generating';

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
      logError(err, { context: 'refreshStyleIdeas' });
      dispatch({type: 'FETCH_IDEAS_ERROR', payload: errorMessage});
    }
  }, []);

  // When an image is uploaded, fetch initial trend ideas if they don't exist
  useEffect(() => {
    if (appStep === 'info' && !styleIdeas) {
      refreshStyleIdeas();
    }
  }, [appStep, styleIdeas, refreshStyleIdeas]);

  useEffect(() => {
    if (isGenerating) {
      const intervalId = setInterval(() => {
        setLoadingMessage(prev => loadingMessages[(loadingMessages.indexOf(prev) + 1) % loadingMessages.length]);
      }, 2500);
      return () => clearInterval(intervalId);
    }
  }, [isGenerating]);

  const handlePersonImagesChange = useCallback((personId: 1 | 2, images: UploadedImageInfo[]) => {
    dispatch({ type: 'SET_PERSON_IMAGES', payload: { personId, images } });
    if (images.length > 0) {
      logEvent('image_uploaded', { count: images.length, personId });
    }
    // Reset local state for that person
    setGeneralSuggestions(prev => ({ ...prev, [personId]: null }));
    setOutfitSuggestions(prev => ({ ...prev, [personId]: {} }));
    setActiveSeason(null);
    setOpenOutfitStyle(null);
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
        logError(err, { context: 'analyzeStyleFromImage' });
        const errorMessage = err instanceof Error ? err.message : '스타일 분석에 실패했습니다.';
        dispatch({ type: 'ANALYZE_STYLE_ERROR', payload: errorMessage });
      }
    } else {
      dispatch({ type: 'CLEAR_STYLE_ANALYSIS' });
    }
  }, []);

  const fetchAndSetGeneralSuggestions = useCallback(async (person: Person) => {
    try {
      const suggestions = await getGeneralSuggestions(person.images[0], person.bodyShape, person.height, person.ageRange, person.personalStyle);
      setGeneralSuggestions(prev => ({...prev, [person.id]: suggestions}));
      dispatch({ type: 'SAVE_INFO_SUCCESS' });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'AI 추천을 생성하는 데 실패했습니다.';
      logError(err, { context: 'fetchAndSetGeneralSuggestions' });
      dispatch({ type: 'GENERATE_ERROR', payload: errorMessage });
    }
  }, []);

  const handleInfoSave = async () => {
    if (selectedPerson.images.length > 0) {
      await fetchAndSetGeneralSuggestions(selectedPerson);
      setActiveSuggestionTab('ai'); // Switch to AI tab after getting suggestions
      if (promptSectionRef.current) {
        promptSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };
  
  const handleGetOutfitSuggestion = useCallback(async (season: Season, style: FashionStyle) => {
    if (selectedPerson.images.length === 0) return;

    setOutfitSuggestions(prev => ({
        ...prev,
        [selectedPersonId]: {
          ...prev[selectedPersonId],
          [season]: { ...prev[selectedPersonId][season], [style]: 'loading' }
        }
    }));

    try {
        const outfits = await getOutfitSuggestion(selectedPerson.images[0], season, style, selectedPerson.bodyShape, selectedPerson.height, selectedPerson.ageRange, selectedPerson.personalStyle);
        setOutfitSuggestions(prev => ({
            ...prev,
            [selectedPersonId]: {
              ...prev[selectedPersonId],
              [season]: { ...prev[selectedPersonId][season], [style]: outfits }
            }
        }));
        logEvent('get_outfit_suggestion_success', { season, style });
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '추천 생성 실패';
        logError(err, { context: 'handleGetOutfitSuggestion', season, style });
        setOutfitSuggestions(prev => ({
            ...prev,
            [selectedPersonId]: {
              ...prev[selectedPersonId],
              [season]: { ...prev[selectedPersonId][season], [style]: errorMessage }
            }
        }));
    }
  }, [selectedPerson]);

    const handleStyleAccordionClick = useCallback((style: FashionStyle) => {
        if (!activeSeason) return; // Guard against null activeSeason
        setOpenOutfitStyle(prev => {
            const newOpenStyle = prev === style ? null : style;
            // Fetch suggestions if we are opening a new style and it hasn't been fetched yet
            if (newOpenStyle && !outfitSuggestions[selectedPersonId][activeSeason]?.[newOpenStyle]) {
                handleGetOutfitSuggestion(activeSeason, newOpenStyle);
            }
            return newOpenStyle;
        });
    }, [activeSeason, outfitSuggestions, handleGetOutfitSuggestion, selectedPersonId]);

  const handleRefreshHairstyles = useCallback(async () => {
    if (selectedPerson.images.length === 0) return;
    setIsRefreshingSuggestions(prev => ({ ...prev, hairstyle: true }));
    try {
        const newSuggestions = await getHairstyleSuggestions(selectedPerson.images[0], selectedPerson.bodyShape, selectedPerson.height, selectedPerson.ageRange, selectedPerson.personalStyle);
        setGeneralSuggestions(prev => ({
            ...prev,
            [selectedPersonId]: {
                ...(prev[selectedPersonId] ?? { '헤어스타일': [], '포즈': [] }),
                '헤어스타일': newSuggestions['헤어스타일'],
            }
        }));
        logEvent('refresh_hairstyles_success');
    } catch (err) {
        logError(err, { context: 'handleRefreshHairstyles' });
    } finally {
        setIsRefreshingSuggestions(prev => ({ ...prev, hairstyle: false }));
    }
  }, [selectedPerson]);

  const handleRefreshPoses = useCallback(async () => {
    if (selectedPerson.images.length === 0) return;
    setIsRefreshingSuggestions(prev => ({ ...prev, pose: true }));
    try {
        const newSuggestions = await getPoseSuggestions(selectedPerson.images[0], selectedPerson.bodyShape, selectedPerson.height, selectedPerson.ageRange, selectedPerson.personalStyle);
        setGeneralSuggestions(prev => ({
            ...prev,
            [selectedPersonId]: {
                ...(prev[selectedPersonId] ?? { '헤어스타일': [], '포즈': [] }),
                '포즈': newSuggestions['포즈'],
            }
        }));
        logEvent('refresh_poses_success');
    } catch (err) {
        logError(err, { context: 'handleRefreshPoses' });
    } finally {
        setIsRefreshingSuggestions(prev => ({ ...prev, pose: false }));
    }
  }, [selectedPerson]);

  const handleExpandPrompt = useCallback(async () => {
    if (!prompt.trim()) return;
    logEvent('expand_prompt_start');
    dispatch({ type: 'EXPAND_PROMPT_START' });
    try {
      const expandedPrompt = await expandPrompt(prompt);
      dispatch({ type: 'EXPAND_PROMPT_SUCCESS', payload: expandedPrompt });
      logEvent('expand_prompt_success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '프롬프트 확장에 실패했습니다.';
      logError(err, { context: 'handleExpandPrompt' });
      dispatch({ type: 'EXPAND_PROMPT_ERROR', payload: errorMessage });
    }
  }, [prompt]);

  const handleGenerateClick = async () => {
    const peopleToGenerate = combineInOneImage ? activePeople : [selectedPerson];
    if (peopleToGenerate.some(p => p.images.length === 0) || !prompt.trim()) {
      dispatch({type: 'GENERATE_ERROR', payload: '사진을 업로드하고 프롬프트를 입력해주세요.'});
      return;
    }
    
    logEvent('generate_start', { prompt_length: prompt.length, reference_image_count: styleReferenceImages.length, people_count: peopleToGenerate.length });
    dispatch({ type: 'GENERATE_START', payload: peopleToGenerate[0].images[0] });

    try {
      const editResult = await editImage(peopleToGenerate, styleReferenceImages, prompt, negativePrompt, cameraComposition);
      dispatch({ type: 'GENERATE_SUCCESS', payload: editResult });
      logEvent('generate_success');
      if (!editResult.image) {
        logEvent('generate_no_image_result');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      logError(err, { context: 'handleGenerateClick' });
      dispatch({ type: 'GENERATE_ERROR', payload: errorMessage });
    }
  };
  
  const handleContinueEditing = useCallback(async () => {
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

    // Reset suggestions for the new image and re-fetch them
    setGeneralSuggestions({ 1: null, 2: null });
    setOutfitSuggestions({ 1: {}, 2: {} });
    setActiveSeason(null);
    setOpenOutfitStyle(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });

  }, [result, dispatch]);
  
  const handleReturnToInfo = useCallback(() => {
    dispatch({ type: 'RETURN_TO_INFO' });
    logEvent('return_to_info');
    if (promptSectionRef.current) {
        promptSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!result?.image) return;
    const link = document.createElement('a');
    link.href = result.image;

    // Extract MIME type from the data URL to determine the correct file extension.
    // e.g., "data:image/jpeg;base64,..." -> "jpeg"
    const mimeType = result.image.split(';')[0].split(':')[1] || 'image/png';
    const extension = mimeType.split('/')[1] || 'png';

    link.download = `ai_styled_photo_${Date.now()}.${extension}`;
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
      if (!(err instanceof Error && err.name === 'AbortError')) {
        logError(err, { context: 'handleShare' });
        alert("사진을 공유하는 데 실패했습니다.");
      }
    }
  }, [result, isShareSupported]);

    const currentStep = (() => {
        if (appStep === 'result') return 3;
        if (appStep === 'info' && isInfoSaved) return 2;
        if (appStep === 'info') return 1;
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
                        const newPrompt = (prompt ? prompt + ', ' : '') + item;
                        dispatch({ type: 'SET_PROMPT_INFO', payload: { field: 'prompt', value: newPrompt } });
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
                className="w-full text-left p-3 bg-white/50 rounded-lg transition-colors duration-200 animate-fade-in-up opacity-0"
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
                        const newPrompt = (prompt ? prompt + ', ' : '') + fullPromptText;
                        dispatch({ type: 'SET_PROMPT_INFO', payload: { field: 'prompt', value: newPrompt } });
                        logEvent('suggestion_clicked', { type: '코디', text: fullPromptText });
                    }}
                    className="mt-3 w-full text-center text-xs font-semibold text-theme-accent bg-theme-accent/10 py-1.5 px-3 rounded-md hover:bg-theme-accent/20 transition-colors"
                    aria-label={`프롬프트에 전체 코디 추가: ${fullPromptText}`}
                >
                    전체 코디 프롬프트에 추가
                </button>
            </div>
        );
    }, [dispatch, prompt]);

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
        const currentGeneralSuggestions = generalSuggestions[selectedPersonId];
        const currentOutfitSuggestions = outfitSuggestions[selectedPersonId];

        if (activeSuggestionTab === 'ai') {
            if (!isInfoSaved && !currentGeneralSuggestions) {
                 return <p className="text-sm text-theme-gray-dark text-center py-8">인물 정보 입력 후 'AI 스타일 추천받기'를 클릭하면 맞춤 추천을 볼 수 있어요.</p>;
            }
            
            return (
                <div className="animate-fade-in-up">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="font-semibold text-theme-text">내 사진 기반 추천</h3>
                    </div>
                    
                    <div className="mb-6">
                        <h4 className="text-sm font-bold text-theme-text mb-2">계절별 코디 추천</h4>
                        <div className="flex space-x-1 bg-theme-bg p-1 rounded-lg mb-4">
                            {SEASONS.map(season => (
                                <button key={season} onClick={() => {
                                    if (activeSeason !== season) {
                                        setOpenOutfitStyle(null);
                                    }
                                    setActiveSeason(season);
                                }} className={`flex-1 text-center text-sm font-semibold p-2 rounded-md transition-colors duration-200 ${activeSeason === season ? 'bg-white text-theme-accent shadow-sm' : 'text-theme-gray-dark hover:bg-white/50'}`}>
                                    {season}
                                </button>
                            ))}
                        </div>
                        {activeSeason ? (
                            <div className="flex flex-col gap-2 animate-fade-in-up">
                                {FASHION_STYLES.map(style => {
                                    const isOpen = openOutfitStyle === style;
                                    const suggestionState = currentOutfitSuggestions[activeSeason]?.[style];
                                    const isLoadingStyle = suggestionState === 'loading';
                                    const hasResult = Array.isArray(suggestionState);
                                    const hasError = typeof suggestionState === 'string' && suggestionState !== 'loading';

                                    return (
                                        <div key={`${activeSeason}-${style}`} className="bg-white/60 rounded-lg shadow-soft overflow-hidden transition-all duration-300">
                                            <button
                                                onClick={() => handleStyleAccordionClick(style)}
                                                className="w-full flex justify-between items-center p-3 text-left"
                                                aria-expanded={isOpen}
                                                aria-controls={`style-panel-${style}`}
                                            >
                                                <span className="font-bold text-theme-text">{style}</span>
                                                <div className="flex items-center gap-2">
                                                    {isLoadingStyle && <Spinner className="w-5 h-5" />}
                                                    <ChevronDownIcon className={`w-5 h-5 text-theme-gray-dark transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                                                </div>
                                            </button>
                                            {isOpen && (
                                                <div id={`style-panel-${style}`} className="p-3 border-t border-theme-gray-light/50 animate-fade-in-up">
                                                    {hasResult && (
                                                        <div className="flex flex-col gap-2">
                                                            {(suggestionState as OutfitDetails[]).map((outfit, index) =>
                                                                renderSuggestionItem(outfit, '코디', index)
                                                            )}
                                                        </div>
                                                    )}
                                                    {hasError && <p className="text-sm text-theme-error text-center p-2">오류: {suggestionState as string}</p>}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-sm text-theme-gray-dark text-center py-4 bg-theme-bg/60 rounded-lg">계절을 선택하여 스타일 추천을 확인하세요.</p>
                        )}
                    </div>
                    
                    {currentGeneralSuggestions && (
                        <>
                            <div className="mb-4">
                                <div className="flex justify-between items-center mb-2">
                                    <h4 className="text-sm font-bold text-theme-text">헤어스타일</h4>
                                    <button onClick={handleRefreshHairstyles} disabled={isRefreshingSuggestions.hairstyle} className="text-sm text-theme-accent hover:underline flex items-center gap-1 disabled:opacity-50">
                                        <RefreshIcon className={`w-4 h-4 ${isRefreshingSuggestions.hairstyle ? 'animate-spin' : ''}`} />
                                        <span>새로고침</span>
                                    </button>
                                </div>
                                {isRefreshingSuggestions.hairstyle ? (
                                    <div className="flex items-center justify-center h-24"><Spinner /></div>
                                ) : currentGeneralSuggestions['헤어스타일'] && (
                                    <div className="flex flex-col gap-2">
                                        {currentGeneralSuggestions['헤어스타일'].map((item, index) => renderSuggestionItem(item, '헤어스타일', index))}
                                    </div>
                                )}
                            </div>
                            <div className="mb-4">
                                <div className="flex justify-between items-center mb-2">
                                    <h4 className="text-sm font-bold text-theme-text">포즈</h4>
                                    <button onClick={handleRefreshPoses} disabled={isRefreshingSuggestions.pose} className="text-sm text-theme-accent hover:underline flex items-center gap-1 disabled:opacity-50">
                                        <RefreshIcon className={`w-4 h-4 ${isRefreshingSuggestions.pose ? 'animate-spin' : ''}`} />
                                        <span>새로고침</span>
                                    </button>
                                </div>
                                {isRefreshingSuggestions.pose ? (
                                    <div className="flex items-center justify-center h-24"><Spinner /></div>
                                ) : currentGeneralSuggestions['포즈'] && (
                                    <div className="flex flex-col gap-2">
                                        {currentGeneralSuggestions['포즈'].map((item, index) => renderSuggestionItem(item, '포즈', index))}
                                    </div>
                                )}
                            </div>
                        </>
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
    }, [activeSuggestionTab, generalSuggestions, outfitSuggestions, activeSeason, openOutfitStyle, handleStyleAccordionClick, isFetchingIdeas, styleIdeas, renderSuggestionCategory, refreshStyleIdeas, renderSuggestionItem, isInfoSaved, dispatch, prompt, handleRefreshHairstyles, handleRefreshPoses, isRefreshingSuggestions, selectedPersonId]);


  const renderResultStep = () => (
    <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-8 mt-8 animate-slide-in-up">
        <div className="bg-theme-surface w-full backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-4">
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
            <div className="w-full flex flex-col gap-3 animate-fade-in-up opacity-0" style={{ animationDelay: '200ms' }}>
                <div className="flex gap-3"><button onClick={handleContinueEditing} className="flex-1 flex items-center justify-center gap-2 bg-theme-accent text-white font-semibold py-3 px-6 rounded-xl shadow-sm hover:bg-theme-accent-hover transition-all duration-200 active:scale-95 text-base" aria-label="이어서 편집하기"><ContinueIcon className="h-5 w-5" /><span>이어서 편집하기</span></button><button onClick={handleReturnToInfo} className="flex-1 flex items-center justify-center gap-2 bg-theme-surface border border-theme-gray-light text-theme-text font-semibold py-3 px-6 rounded-xl shadow-sm hover:bg-theme-gray-light/50 transition-all duration-200 active:scale-95 text-base" aria-label="스타일 설명으로 돌아가기"><BackIcon className="h-5 w-5" /><span>스타일 설명으로 돌아가기</span></button></div>
                <div className="flex gap-3"><button onClick={handleDownload} className="flex-1 flex items-center justify-center gap-2 bg-theme-surface border border-theme-gray-light text-theme-text font-semibold py-3 px-6 rounded-xl shadow-sm hover:bg-theme-gray-light/50 transition-all duration-200 active:scale-95 text-base" aria-label="이미지 저장"><DownloadIcon className="h-5 w-5" /><span>저장</span></button>{isShareSupported && (<button onClick={handleShare} className="flex-1 flex items-center justify-center gap-2 bg-theme-surface border border-theme-gray-light text-theme-text font-semibold py-3 px-6 rounded-xl shadow-sm hover:bg-theme-gray-light/50 transition-all duration-200 active:scale-95 text-base" aria-label="이미지 공유"><ShareIcon className="h-5 w-5" /><span>공유</span></button>)}</div>
            </div>
        )}
        {generatingStatus === 'error' && (
            <div className="w-full flex flex-col gap-3 animate-fade-in-up opacity-0" style={{ animationDelay: '200ms' }}>
                <button onClick={handleReturnToInfo} className="w-full flex items-center justify-center gap-2 bg-theme-surface border border-theme-gray-light text-theme-text font-semibold py-3 px-6 rounded-xl shadow-sm hover:bg-theme-gray-light/50 transition-all duration-200 active:scale-95 text-base" aria-label="스타일 설명으로 돌아가기" >
                    <BackIcon className="h-5 w-5" />
                    <span>스타일 설명으로 돌아가기</span>
                </button>
            </div>
        )}
        {result?.text && ( <div className="bg-theme-surface w-full backdrop-blur-xl border border-white/30 p-4 rounded-xl text-sm text-theme-text shadow-soft animate-fade-in-up"><p><span className="font-bold text-theme-accent">AI의 메모:</span> {result.text}</p></div>)}

        {/* NEW: Generation History Gallery */}
        {generationHistory.length > 0 && (
            <div className="w-full flex flex-col gap-4 mt-4 animate-slide-in-up" style={{ animationDelay: '300ms' }}>
                <div className="bg-theme-surface backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-4">
                    <h3 className="text-lg font-bold text-theme-text mb-4 px-2">생성 기록</h3>
                    <div className="flex gap-3 overflow-x-auto pb-3 -mb-3">
                        {generationHistory.map((item, index) => item.result.image && (
                            <button
                                key={index}
                                onClick={() => dispatch({ type: 'LOAD_FROM_HISTORY', payload: item })}
                                className={`
                                    relative flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden transition-all duration-200
                                    focus:outline-none focus:ring-4 focus:ring-offset-2 focus:ring-offset-theme-surface focus:ring-theme-accent
                                    ${result?.image === item.result.image ? 'ring-4 ring-theme-accent shadow-medium' : 'ring-1 ring-black/10 hover:ring-2 hover:ring-theme-accent/70'}
                                `}
                                aria-label={`결과 ${index + 1} 불러오기`}
                            >
                                <img 
                                    src={item.result.image} 
                                    alt={`Generated history item ${index + 1}`} 
                                    className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 hover:opacity-100 transition-opacity" />
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        )}
    </div>
  );

  const renderUploadStep = () => (
      <section className="w-full max-w-3xl mx-auto mt-8 animate-slide-in-up">
        <div className="bg-theme-surface backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-6 md:p-8">
            <h2 className="text-2xl font-bold text-theme-text mb-2 text-center">인원 선택</h2>
            <p className="text-theme-gray-dark mb-6 text-center">스타일링할 인원 수를 선택해주세요.</p>
            <div className="flex justify-center gap-4 mb-8">
                <button onClick={() => dispatch({type: 'SET_NUMBER_OF_PEOPLE', payload: 1})} className={`px-8 py-3 rounded-lg font-semibold border-2 transition-all ${numberOfPeople === 1 ? 'bg-theme-accent text-white border-theme-accent' : 'bg-theme-bg/80 border-theme-gray-light'}`}>1명</button>
                <button onClick={() => dispatch({type: 'SET_NUMBER_OF_PEOPLE', payload: 2})} className={`px-8 py-3 rounded-lg font-semibold border-2 transition-all ${numberOfPeople === 2 ? 'bg-theme-accent text-white border-theme-accent' : 'bg-theme-bg/80 border-theme-gray-light'}`}>2명</button>
            </div>
            
            <div className={`grid grid-cols-1 ${numberOfPeople === 2 ? 'md:grid-cols-2' : ''} gap-6`}>
                {Array.from({ length: numberOfPeople }).map((_, index) => {
                    const personId = (index + 1) as 1 | 2;
                    const person = people.find(p => p.id === personId)!;
                    return (
                        <div key={personId}>
                            <h3 className="text-lg font-bold text-theme-text mb-4 text-center">{personId}번 인물</h3>
                            <div className="aspect-square sm:aspect-[4/3] w-full">
                                <ImageUploader onImagesChange={(images) => handlePersonImagesChange(personId, images)} currentImages={person.images} maxImages={5} />
                            </div>
                        </div>
                    );
                })}
            </div>

            <button
                onClick={() => dispatch({type: 'SET_APP_STEP', payload: 'info'})}
                disabled={activePeople.length !== numberOfPeople}
                className="mt-8 w-full flex items-center justify-center gap-2 bg-theme-accent text-white font-semibold py-3 px-8 rounded-xl shadow-sm hover:bg-theme-accent-hover disabled:bg-theme-gray-light disabled:text-theme-gray-dark disabled:cursor-not-allowed transition-all duration-200 active:scale-95"
            >
                다음으로
            </button>
        </div>
    </section>
  );

  const renderInfoStep = () => (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 xl:gap-12 mt-8 animate-slide-in-up">
            {/* Left Column: Image Preview & Person Selector */}
            <div className="lg:sticky lg:top-8 self-start flex flex-col gap-6">
                 <details className="bg-theme-surface backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-4 group" open>
                     <summary className="flex items-center justify-between cursor-pointer list-none">
                         <h3 className="text-lg font-bold text-theme-text">업로드된 사진</h3>
                         <ChevronDownIcon className="w-6 h-6 text-theme-gray-dark transition-transform duration-300 group-open:rotate-180" />
                     </summary>
                     <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {people.slice(0, numberOfPeople).map(person => (
                            <div key={person.id}>
                                <h4 className="font-semibold text-center mb-2">{person.id}번 인물</h4>
                                <div className="w-full rounded-lg overflow-hidden bg-black/5 ring-1 ring-black/5 shadow-inner relative group aspect-square">
                                    {person.images.length > 0 ? (
                                        <img src={`data:${person.images[0].mimeType};base64,${person.images[0].base64}`} alt={`${person.id}번 인물 사진`} className="w-full h-full object-contain" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-theme-gray-dark text-sm">사진 없음</div>
                                    )}
                                </div>
                            </div>
                        ))}
                     </div>
                     <button onClick={() => dispatch({type: 'SET_APP_STEP', payload: 'upload'})} className="mt-4 w-full text-sm text-center text-theme-accent hover:underline">사진 변경하기</button>
                 </details>

                 {numberOfPeople > 1 && (
                    <div className="bg-theme-surface backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-4">
                        <h3 className="text-lg font-bold text-theme-text mb-4">인물 고르기</h3>
                         <div className="flex justify-center gap-4">
                            <button onClick={() => dispatch({type: 'SET_SELECTED_PERSON_ID', payload: 1})} className={`px-8 py-3 rounded-lg font-semibold border-2 transition-all ${selectedPersonId === 1 ? 'bg-theme-accent text-white border-theme-accent' : 'bg-theme-bg/80 border-theme-gray-light'}`}>1번 인물</button>
                            <button onClick={() => dispatch({type: 'SET_SELECTED_PERSON_ID', payload: 2})} className={`px-8 py-3 rounded-lg font-semibold border-2 transition-all ${selectedPersonId === 2 ? 'bg-theme-accent text-white border-theme-accent' : 'bg-theme-bg/80 border-theme-gray-light'}`}>2번 인물</button>
                        </div>
                    </div>
                 )}
            </div>

            {/* Right Column: Controls */}
            <div className="flex flex-col gap-8">
                {/* --- Step 2: User Info --- */}
                <section className="bg-theme-surface backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-6 md:p-8 animate-slide-in-up">
                    <h2 className="text-xl font-bold text-theme-text mb-4">
                        {numberOfPeople > 1 ? `${selectedPersonId}번 인물 ` : ''}정보 입력
                    </h2>
                    <p className="text-theme-gray-dark mb-6 text-sm">더 정확한 스타일 추천을 위해 정보를 입력해주세요. (선택 사항)</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div><label htmlFor="bodyShape" className="block text-sm font-medium text-theme-text mb-1.5">체형</label><select id="bodyShape" value={selectedPerson.bodyShape} onChange={(e) => dispatch({type: 'SET_PERSON_INFO', payload: {personId: selectedPersonId, field: 'bodyShape', value: e.target.value}})} className="w-full bg-theme-bg/80 border border-theme-gray-light rounded-lg p-3 text-base focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200"><option value="">선택 안함</option>{bodyShapeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                        <div><label htmlFor="height" className="block text-sm font-medium text-theme-text mb-1.5">키 (cm)</label><input id="height" type="number" placeholder="예: 165" value={selectedPerson.height} onChange={(e) => dispatch({type: 'SET_PERSON_INFO', payload: {personId: selectedPersonId, field: 'height', value: e.target.value}})} className="w-full bg-theme-bg/80 border border-theme-gray-light rounded-lg p-3 text-base focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200" /></div>
                        <div><label htmlFor="ageRange" className="block text-sm font-medium text-theme-text mb-1.5">나이대</label><select id="ageRange" value={selectedPerson.ageRange} onChange={(e) => dispatch({type: 'SET_PERSON_INFO', payload: {personId: selectedPersonId, field: 'ageRange', value: e.target.value}})} className="w-full bg-theme-bg/80 border border-theme-gray-light rounded-lg p-3 text-base focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200"><option value="">선택 안함</option>{ageRangeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                        <div><label htmlFor="personalStyle" className="block text-sm font-medium text-theme-text mb-1.5">선호 스타일</label><select id="personalStyle" value={selectedPerson.personalStyle} onChange={(e) => dispatch({type: 'SET_PERSON_INFO', payload: {personId: selectedPersonId, field: 'personalStyle', value: e.target.value}})} className="w-full bg-theme-bg/80 border border-theme-gray-light rounded-lg p-3 text-base focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200"><option value="">선택 안함</option>{personalStyleOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                    </div>
                    <button onClick={handleInfoSave} disabled={selectedPerson.images.length === 0} className="mt-6 w-full flex items-center justify-center gap-2 bg-theme-text text-white font-semibold py-3 px-8 rounded-xl shadow-sm hover:bg-theme-text/80 disabled:bg-theme-gray-light disabled:text-theme-gray-dark disabled:cursor-not-allowed transition-all duration-200 active:scale-95">
                      {isInfoSaved && generalSuggestions[selectedPersonId] ? '추천 새로고침' : 'AI 스타일 추천받기'}
                    </button>
                </section>

                {/* --- Step 3: Prompt & Suggestions --- */}
                {isInfoSaved && (
                    <div ref={promptSectionRef} className="flex flex-col gap-8 animate-slide-in-up" style={{ animationDelay: '150ms'}}>
                        <section className="bg-theme-surface backdrop-blur-xl border border-white/30 shadow-soft rounded-2xl p-6 md:p-8">
                             <h2 className="text-xl font-bold text-theme-text mb-4">스타일 설명</h2>

                             {numberOfPeople > 1 && (
                                <div className="flex items-center justify-between bg-theme-bg/60 p-3 rounded-lg border border-theme-gray-light/50 mb-6">
                                  <label htmlFor="combine-toggle" className="font-semibold text-theme-text cursor-pointer">하나의 사진으로 나오기</label>
                                  <button
                                    id="combine-toggle"
                                    role="switch"
                                    aria-checked={combineInOneImage}
                                    onClick={() => dispatch({type: 'TOGGLE_COMBINE_IN_ONE_IMAGE'})}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${combineInOneImage ? 'bg-theme-accent' : 'bg-theme-gray-light'}`}
                                  >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${combineInOneImage ? 'translate-x-6' : 'translate-x-1'}`} />
                                  </button>
                                </div>
                             )}

                            <div className="relative w-full">
                                <textarea className="w-full bg-theme-bg/80 border-2 border-theme-gray-light rounded-lg p-4 pr-10 placeholder-theme-gray-dark focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200 min-h-[120px] text-base" placeholder={combineInOneImage ? "예: 1번 인물은 파란색 드레스를, 2번 인물은 검정 수트를 입혀주세요." : "예시: 오버사이즈 그레이 블레이저를 입고 주머니에 손을 넣은 포즈로 바꿔줘."} value={prompt} onChange={(e) => dispatch({type: 'SET_PROMPT_INFO', payload: {field: 'prompt', value: e.target.value}})} disabled={isLoading} />
                                {prompt && !isLoading && (<button onClick={() => dispatch({type: 'SET_PROMPT_INFO', payload: {field: 'prompt', value: ''}})} className="absolute top-3 right-3 p-1 text-theme-gray-dark hover:text-theme-text hover:bg-theme-gray-light/50 rounded-full transition-colors duration-200" aria-label="프롬프트 지우기"><CloseIcon className="w-5 h-5" /></button>)}
                                <button onClick={handleExpandPrompt} disabled={isLoading || !prompt.trim()} className="absolute bottom-3 left-3 flex items-center gap-1.5 text-xs font-semibold bg-theme-surface border border-theme-gray-light text-theme-text py-1 px-2.5 rounded-lg shadow-sm hover:bg-theme-gray-light/50 transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                                    {isExpandingPrompt ? <Spinner className="w-4 h-4" /> : <SparklesIcon className="h-4 w-4 text-theme-accent" />}
                                    <span>프롬프트 확장</span>
                                </button>
                            </div>
                            <div className="mt-4 relative w-full">
                                <label htmlFor="negativePrompt" className="block text-sm font-medium text-theme-text mb-1.5">제외하고 싶은 내용 (선택)</label>
                                <textarea id="negativePrompt" className="w-full bg-theme-bg/80 border-2 border-theme-gray-light rounded-lg p-3 placeholder-theme-gray-dark focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent transition-all duration-200 min-h-[60px] text-sm" placeholder="예: 안경, 모자, 흐린 배경" value={negativePrompt} onChange={(e) => dispatch({type: 'SET_PROMPT_INFO', payload: {field: 'negativePrompt', value: e.target.value}})} disabled={isLoading} />
                            </div>
                            <div className="mt-6">
                                <h3 className="text-base font-semibold text-theme-text mb-2">카메라 구도</h3>
                                <p className="text-sm text-theme-gray-dark mb-3">생성될 이미지의 카메라 앵글과 프레임을 선택하세요.</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => dispatch({ type: 'SET_CAMERA_COMPOSITION', payload: 'keep' })}
                                        type="button"
                                        className={`w-full text-center p-4 rounded-xl border-2 transition-all duration-200 flex flex-col items-center justify-start gap-2 h-32 ${
                                            cameraComposition === 'keep'
                                                ? 'bg-theme-accent/10 border-theme-accent text-theme-accent ring-2 ring-theme-accent'
                                                : 'bg-theme-bg/80 border-theme-gray-light hover:border-theme-accent/50 hover:shadow-soft'
                                        }`}
                                    >
                                        <FrameIcon className="w-6 h-6 mb-1 flex-shrink-0" />
                                        <div className="flex flex-col">
                                            <span className="font-semibold text-sm">기존 구도 유지</span>
                                            <span className="text-xs text-theme-gray-dark mt-1">
                                                원본 사진의 앵글과 프레임을 유지합니다.
                                            </span>
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => dispatch({ type: 'SET_CAMERA_COMPOSITION', payload: 'recompose' })}
                                        type="button"
                                        className={`w-full text-center p-4 rounded-xl border-2 transition-all duration-200 flex flex-col items-center justify-start gap-2 h-32 ${
                                            cameraComposition === 'recompose'
                                                ? 'bg-theme-accent/10 border-theme-accent text-theme-accent ring-2 ring-theme-accent'
                                                : 'bg-theme-bg/80 border-theme-gray-light hover:border-theme-accent/50 hover:shadow-soft'
                                        }`}
                                    >
                                        <SparklesIcon className="w-6 h-6 mb-1 flex-shrink-0" />
                                        <div className="flex flex-col">
                                            <span className="font-semibold text-sm">새로운 구도 제안</span>
                                            <span className="text-xs text-theme-gray-dark mt-1">
                                                AI가 더 매력적인 앵글을 자유롭게 제안합니다.
                                            </span>
                                        </div>
                                    </button>
                                </div>
                            </div>
                            <div className="mt-6">
                                <h3 className="text-base font-semibold text-theme-text mb-2">참고 스타일 이미지 (선택)</h3>
                                <p className="text-sm text-theme-gray-dark mb-3">원하는 스타일의 사진을 추가하여 AI에게 더 정확한 요청을 할 수 있습니다. (최대 5장)</p>
                                <div className="bg-theme-bg/60 rounded-lg p-3 border border-theme-gray-light/50">
                                    <div className="h-40"><ImageUploader onImagesChange={handleStyleReferenceImagesChange} currentImages={styleReferenceImages} maxImages={5} /></div>
                                    {isAnalyzingStyle && (
                                        <div className="flex flex-col items-center justify-center pt-6 text-sm text-theme-gray-dark">
                                            <Spinner />
                                            <p className="mt-2">이미지 스타일 분석 중...</p>
                                        </div>
                                    )}
                                    {styleReferenceAnalysis && !isAnalyzingStyle && (
                                        <div className="mt-4 pt-4 border-t border-theme-gray-light/80 animate-fade-in-up">
                                            <h4 className="font-semibold text-theme-text mb-3">참고 이미지 스타일 분석 결과</h4>
                                            {renderSuggestionCategory('코디', styleReferenceAnalysis['코디'], '코디')}
                                            {renderSuggestionCategory('헤어스타일', styleReferenceAnalysis['헤어스타일'], '헤어스타일')}
                                            {renderSuggestionCategory('포즈', styleReferenceAnalysis['포즈'], '포즈')}
                                        </div>
                                    )}
                                    {styleReferenceAnalysisError && !isAnalyzingStyle && (
                                        <div className="mt-4 pt-4 border-t border-theme-gray-light/80">
                                            <p className="text-sm text-theme-error text-center p-2 bg-theme-error-bg rounded-md">{styleReferenceAnalysisError}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="mt-6"><div className="border-b border-theme-gray-light flex space-x-4"><button onClick={() => setActiveSuggestionTab('ai')} className={`py-2 px-1 text-sm font-semibold transition-colors duration-200 ${ activeSuggestionTab === 'ai' ? 'border-b-2 border-theme-accent text-theme-accent' : 'text-theme-gray-dark hover:text-theme-text'}`}>AI 추천 스타일</button><button onClick={() => setActiveSuggestionTab('ideas')} className={`py-2 px-1 text-sm font-semibold transition-colors duration-200 ${ activeSuggestionTab === 'ideas' ? 'border-b-2 border-theme-accent text-theme-accent' : 'text-theme-gray-dark hover:text-theme-text'}`}>최신 트렌드 아이디어</button></div><div className="pt-4 min-h-[200px]">{renderSuggestionsContent()}</div></div>
                        </section>
                        <button onClick={handleGenerateClick} disabled={isLoading || activePeople.length === 0 || !prompt} className="w-full flex items-center justify-center gap-3 bg-theme-accent text-white font-bold text-lg py-4 px-6 rounded-xl shadow-medium hover:bg-theme-accent-hover disabled:bg-theme-gray-light disabled:text-theme-gray-dark disabled:cursor-not-allowed transition-all duration-200 active:scale-95">{isGenerating ? (<><Spinner /><span>생성 중...</span></>) : (<><SparklesIcon className="h-6 w-6" /><span>스타일 적용</span></>)}</button>
                    </div>
                )}
            </div>
        </div>
    );
  
  const renderContent = () => {
    switch(appStep) {
        case 'upload':
            return renderUploadStep();
        case 'info':
            return renderInfoStep();
        case 'result':
            return renderResultStep();
        default:
            return renderUploadStep();
    }
  }
  
  return (
    <>
      <div className="h-full w-full bg-theme-bg text-theme-text font-sans p-4 sm:p-6 md:p-8 overflow-y-auto overflow-x-hidden">
        <style>{`.transition-all { transition-timing-function: cubic-bezier(0.25, 0.1, 0.25, 1); } details[open] summary ~ * { animation: slideInUp 0.5s ease-out; } details summary svg { transition: transform 0.3s ease; } details[open] summary svg { transform: rotate(180deg); }`}</style>
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
