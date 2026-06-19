import React, { useEffect, useState } from 'react';

interface AppPreviewLayoutProps {
  children: React.ReactNode;
}

const AppPreviewLayout: React.FC<AppPreviewLayoutProps> = ({ children }) => {
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    // Check if running in a native Capacitor environment
    // @ts-ignore
    if (window.Capacitor && window.Capacitor.isNative) {
      setIsNative(true);
    }
  }, []);

  if (isNative) {
    return <div className="w-full h-full relative overflow-hidden">{children}</div>;
  }

  return (
    <div className="min-h-screen w-full bg-gray-900 text-white flex flex-col md:flex-row overflow-hidden">
      {/* Mobile view (default, fills screen) */}
      <div className="md:hidden w-full h-full relative overflow-hidden">
        {children}
      </div>

      {/* Desktop view (iPhone frame on the left, info on the right) */}
      <div className="hidden md:flex w-full h-full p-8 lg:p-12 items-center justify-start gap-12">
        {/* Left: iPhone Frame */}
        <div 
          className="relative flex-shrink-0 bg-black rounded-[50px] shadow-2xl overflow-hidden border-[8px] border-gray-800"
          style={{ width: '390px', height: '844px' }} // iPhone 12/13/14 Pro dimensions
        >
          {/* Top Notch */}
          <div className="absolute top-0 inset-x-0 h-[30px] w-[160px] mx-auto bg-black rounded-b-[20px] z-50"></div>
          
          {/* App Content */}
          <div className="w-full h-full bg-theme-bg overflow-hidden relative rounded-[42px]">
            {children}
          </div>
        </div>

        {/* Right: Dashboard / Editor Area */}
        <div className="flex-1 h-full flex flex-col items-start justify-center border border-gray-800 rounded-3xl bg-gray-800/50 p-12">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent">
            AI Fashion Stylist Editor
          </h1>
          <p className="text-gray-400 text-lg mb-8 max-w-2xl">
            Live preview of your iOS application. Any changes made to the source will instantly reflect on the device simulator.
          </p>
          
          <div className="grid grid-cols-2 gap-6 w-full max-w-2xl">
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-white font-semibold mb-2">Build iOS App</h3>
              <p className="text-sm text-gray-400 mb-4">Run the following command to sync and open Xcode.</p>
              <code className="bg-black text-emerald-400 px-3 py-2 rounded-lg text-sm block">npx cap open ios</code>
            </div>
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-white font-semibold mb-2">Build Android App</h3>
              <p className="text-sm text-gray-400 mb-4">Run the following command to sync and open Android Studio.</p>
              <code className="bg-black text-emerald-400 px-3 py-2 rounded-lg text-sm block">npx cap open android</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppPreviewLayout;
