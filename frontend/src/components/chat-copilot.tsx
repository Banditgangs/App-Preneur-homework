import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Bot, User, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function ChatCopilot({ activeScanId }: { activeScanId: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Merhaba! Ben NexusOSINT SOC Copilot. Sistemin veya taranan hedefin durumuyla ilgili bana sorular sorabilirsiniz.' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Yeni bir tarama başladığında sohbeti sıfırla veya bildir
  useEffect(() => {
    if (activeScanId) {
      setMessages([{ role: 'assistant', content: `Yeni bir hedef taraması algılandı. Bu hedefin OSINT verilerini okuyup size yardımcı olabilirim. Ne öğrenmek istersiniz?` }]);
    }
  }, [activeScanId]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    const userMessage: Message = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await api.chatWithCopilot(
        activeScanId, 
        newMessages.map(m => ({ role: m.role, content: m.content }))
      );
      setMessages([...newMessages, { role: 'assistant', content: response.reply }]);
    } catch (error) {
      setMessages([...newMessages, { role: 'assistant', content: 'Bağlantı hatası: Chat API\'ye ulaşılamadı. Lütfen sunucuyu kontrol edin.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end">
      {/* Chat Window */}
      {isOpen && (
        <div className="w-[calc(100vw-3rem)] sm:w-96 h-[60vh] sm:h-[32rem] bg-slate-950 border border-slate-800 rounded-2xl shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col mb-4 overflow-hidden animate-in slide-in-from-bottom-5 fade-in duration-300">
          
          {/* Header */}
          <div className="bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-cyan-950 flex items-center justify-center border border-cyan-800">
                <Bot className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-200">SOC Copilot</h3>
                <p className="text-[10px] text-cyan-500 font-mono tracking-widest uppercase flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse"></span>
                  Online
                </p>
              </div>
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-800">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-slate-800' : 'bg-cyan-950 border border-cyan-800'}`}>
                  {msg.role === 'user' ? <User className="w-3.5 h-3.5 text-slate-300" /> : <Bot className="w-3.5 h-3.5 text-cyan-400" />}
                </div>
                <div className={`p-3 rounded-2xl max-w-[80%] text-sm ${
                  msg.role === 'user' 
                    ? 'bg-slate-800 text-slate-200 rounded-tr-sm' 
                    : 'bg-slate-900/60 border border-slate-800 text-slate-300 rounded-tl-sm'
                }`}>
                  <p className="whitespace-pre-wrap leading-relaxed font-sans">{msg.content}</p>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-cyan-950 border border-cyan-800 flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800 rounded-tl-sm flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-cyan-500 animate-spin" />
                  <span className="text-xs text-slate-500 font-mono">Analyzing...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-3 bg-slate-900 border-t border-slate-800">
            <div className="relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about vulnerabilities..."
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded-xl pl-4 pr-12 py-3 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 resize-none h-12 scrollbar-hide"
                rows={1}
              />
              <button 
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="absolute right-2 top-1.5 p-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 hover:scale-105 ${
          isOpen 
            ? 'bg-slate-800 text-slate-400 hover:text-white rotate-90' 
            : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_20px_rgba(6,182,212,0.4)]'
        }`}
      >
        {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
      </button>
    </div>
  );
}
