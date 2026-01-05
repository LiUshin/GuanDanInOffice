import React from 'react';

export const FakeIDE = () => {
  return (
    <div className="fixed inset-0 z-[9999] bg-[#1e1e1e] text-[#d4d4d4] font-mono text-sm flex flex-col select-none">
      {/* Menu Bar */}
      <div className="h-8 bg-[#3c3c3c] flex items-center px-4 gap-4 text-xs">
        <span>File</span>
        <span>Edit</span>
        <span>Selection</span>
        <span>View</span>
        <span>Go</span>
        <span>Run</span>
        <span>Terminal</span>
        <span>Help</span>
      </div>
      
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-12 bg-[#333333] flex flex-col items-center py-4 gap-4 border-r border-[#2b2b2b]">
           <div className="w-6 h-6 border-l-2 border-white"></div>
           <div className="w-6 h-6 bg-white opacity-20 mask-search"></div>
           <div className="w-6 h-6 bg-white opacity-20"></div>
        </div>
        
        {/* File Explorer */}
        <div className="w-64 bg-[#252526] flex flex-col border-r border-[#2b2b2b]">
            <div className="h-8 flex items-center px-4 text-xs font-bold uppercase tracking-wider">Explorer</div>
            <div className="px-4 py-1 hover:bg-[#37373d] cursor-pointer flex items-center gap-1">
                <span>v</span> <span>src</span>
            </div>
            <div className="px-8 py-1 hover:bg-[#37373d] cursor-pointer text-[#519aba] flex items-center gap-2">
                <span className="text-yellow-500">TS</span> game.ts
            </div>
            <div className="px-8 py-1 hover:bg-[#37373d] cursor-pointer text-[#519aba] flex items-center gap-2">
                <span className="text-yellow-500">TS</span> server.ts
            </div>
            <div className="px-8 py-1 hover:bg-[#37373d] cursor-pointer text-[#e37933] flex items-center gap-2">
                <span className="text-gray-400">#</span> README.md
            </div>
        </div>
        
        {/* Editor Area */}
        <div className="flex-1 flex flex-col bg-[#1e1e1e]">
            {/* Tabs */}
            <div className="h-9 bg-[#2d2d2d] flex">
                <div className="px-4 flex items-center bg-[#1e1e1e] border-t-2 border-[#007acc] text-[#ffffff]">
                    <span className="mr-2 text-[#519aba]">TS</span>
                    game.ts
                    <span className="ml-2 text-xs hover:bg-[#3c3c3c] rounded p-0.5">x</span>
                </div>
            </div>
            
            {/* Code */}
            <div className="flex-1 p-4 overflow-auto font-mono text-[14px] leading-6">
                <div className="flex">
                    <div className="w-8 text-[#858585] text-right mr-4 select-none opacity-50">
                        1<br/>2<br/>3<br/>4<br/>5<br/>6<br/>7<br/>8<br/>9<br/>10<br/>11<br/>12<br/>13<br/>14<br/>15
                    </div>
                    <div>
                        <span className="text-[#c586c0]">import</span> <span className="text-[#9cdcfe]">{`{ Server }`}</span> <span className="text-[#c586c0]">from</span> <span className="text-[#ce9178]">'socket.io'</span>;<br/>
                        <span className="text-[#c586c0]">import</span> <span className="text-[#9cdcfe]">{`{ GameState }`}</span> <span className="text-[#c586c0]">from</span> <span className="text-[#ce9178]">'./types'</span>;<br/>
                        <br/>
                        <span className="text-[#6a9955]">/**</span><br/>
                        <span className="text-[#6a9955]">&nbsp;* Main game engine class handling core logic</span><br/>
                        <span className="text-[#6a9955]">&nbsp;*/</span><br/>
                        <span className="text-[#c586c0]">export class</span> <span className="text-[#4ec9b0]">GameEngine</span> <span className="text-[#ffd700]">{`{`}</span><br/>
                        &nbsp;&nbsp;<span className="text-[#c586c0]">private</span> <span className="text-[#9cdcfe]">io</span>: <span className="text-[#4ec9b0]">Server</span>;<br/>
                        &nbsp;&nbsp;<span className="text-[#c586c0]">private</span> <span className="text-[#9cdcfe]">state</span>: <span className="text-[#4ec9b0]">GameState</span>;<br/>
                        <br/>
                        &nbsp;&nbsp;<span className="text-[#c586c0]">constructor</span>(<span className="text-[#9cdcfe]">io</span>: <span className="text-[#4ec9b0]">Server</span>) <span className="text-[#ffd700]">{`{`}</span><br/>
                        &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#569cd6]">this</span>.<span className="text-[#9cdcfe]">io</span> = <span className="text-[#9cdcfe]">io</span>;<br/>
                        &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#6a9955]">// Initialize game state logic</span><br/>
                        &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#569cd6]">this</span>.<span className="text-[#dcdcaa]">initialize</span>();<br/>
                        &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#dcdcaa]">console</span>.<span className="text-[#dcdcaa]">log</span>(<span className="text-[#ce9178]">'System ready.'</span>);<br/>
                        &nbsp;&nbsp;<span className="text-[#ffd700]">{`}`}</span><br/>
                        <span className="text-[#ffd700]">{`}`}</span>
                    </div>
                </div>
            </div>
            
            {/* Bottom Panel */}
            <div className="h-32 border-t border-[#2b2b2b] p-2 bg-[#1e1e1e]">
                <div className="flex gap-4 text-xs mb-2 border-b border-[#2b2b2b] pb-1 uppercase tracking-wide">
                    <span className="border-b border-transparent opacity-50 hover:opacity-100 cursor-pointer">Problems</span>
                    <span className="border-b border-transparent opacity-50 hover:opacity-100 cursor-pointer">Output</span>
                    <span className="border-b border-transparent opacity-50 hover:opacity-100 cursor-pointer">Debug Console</span>
                    <span className="border-b border-[#e7e7e7] cursor-pointer">Terminal</span>
                </div>
                <div className="font-mono text-xs">
                    <span className="text-[#9cdcfe]">user@dev-machine</span>:<span className="text-[#ce9178]">~/project/backend</span>$ npm run watch<br/>
                    &gt; watching for changes...<br/>
                    <span className="text-[#6a9955]">✓ Compilation complete. Watching for file changes.</span><br/>
                    <span className="text-[#9cdcfe]">user@dev-machine</span>:<span className="text-[#ce9178]">~/project/backend</span>$ <span className="animate-pulse">_</span>
                </div>
            </div>
        </div>
      </div>
      
      {/* Status Bar */}
      <div className="h-6 bg-[#007acc] text-white flex items-center px-3 text-xs justify-between select-none">
          <div className="flex gap-4">
              <span className="flex items-center gap-1"><span className="font-bold">⑂</span> main*</span>
              <span>0 errors, 0 warnings</span>
          </div>
          <div className="flex gap-4">
              <span>Ln 10, Col 1</span>
              <span>UTF-8</span>
              <span>TypeScript</span>
              <span>Prettier</span>
              <span className="hover:bg-[#1f8ad2] px-1 cursor-pointer">🔔</span>
          </div>
      </div>
    </div>
  );
};
