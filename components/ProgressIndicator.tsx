import React from 'react';

interface ProgressIndicatorProps {
  steps: string[];
  currentStep: number;
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ steps, currentStep }) => {
  return (
    <nav aria-label="Progress">
      <ol role="list" className="flex items-center">
        {steps.map((step, stepIdx) => (
          <li key={step} className={`relative ${stepIdx !== steps.length - 1 ? 'pr-8 sm:pr-20' : ''}`}>
            {stepIdx < currentStep ? (
              <>
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="h-0.5 w-full bg-theme-accent" />
                </div>
                <div
                  className="relative flex h-8 w-8 items-center justify-center bg-theme-accent rounded-full"
                >
                  <svg
                    className="h-5 w-5 text-white"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.052-.143z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="sr-only">{step} - 완료</span>
                </div>
              </>
            ) : stepIdx === currentStep ? (
              <>
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="h-0.5 w-full bg-theme-gray-light" />
                </div>
                <div
                  className="relative flex h-8 w-8 items-center justify-center bg-theme-bg border-2 border-theme-accent rounded-full"
                  aria-current="step"
                >
                  <span className="h-2.5 w-2.5 bg-theme-accent rounded-full" aria-hidden="true" />
                  <span className="sr-only">{step} - 현재 단계</span>
                </div>
              </>
            ) : (
              <>
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="h-0.5 w-full bg-theme-gray-light" />
                </div>
                <div
                  className="relative flex h-8 w-8 items-center justify-center bg-theme-bg border-2 border-theme-gray-light rounded-full"
                >
                 <span className="sr-only">{step}</span>
                </div>
              </>
            )}
             <p className="absolute -bottom-7 w-max -left-2 text-center text-sm font-medium text-theme-text">{step}</p>
          </li>
        ))}
      </ol>
    </nav>
  );
};

export default ProgressIndicator;
