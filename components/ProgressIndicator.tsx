
import React from 'react';

interface ProgressIndicatorProps {
  steps: string[];
  currentStep: number;
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ steps, currentStep }) => {
  return (
    <div role="list" className="flex items-start w-full">
      {steps.map((step, stepIdx) => (
        <React.Fragment key={step}>
          <div className="flex flex-col items-center flex-shrink-0 relative">
            {/* Circle and Number */}
            <div className={`
              w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg transition-all duration-300
              ${stepIdx < currentStep ? 'bg-theme-accent text-white' : ''}
              ${stepIdx === currentStep ? 'bg-theme-bg border-2 border-theme-accent text-theme-accent' : ''}
              ${stepIdx > currentStep ? 'bg-theme-surface border border-theme-gray-light text-theme-gray-dark' : ''}
            `}>
              {stepIdx < currentStep ? (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span>{stepIdx + 1}</span>
              )}
            </div>
            {/* Label */}
            <p className={`
              mt-3 text-center text-xs sm:text-sm font-medium transition-colors duration-300 w-20 sm:w-24
              ${stepIdx <= currentStep ? 'text-theme-text' : 'text-theme-gray-dark'}
            `}>
              {step}
            </p>
          </div>

          {/* Connecting Line */}
          {stepIdx < steps.length - 1 && (
            <div className="flex-1 h-0.5 mt-5 bg-theme-gray-light relative">
              <div 
                className="absolute top-0 left-0 h-full bg-theme-accent transition-all duration-500" 
                style={{ width: stepIdx < currentStep ? '100%' : '0%' }} 
              />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default ProgressIndicator;