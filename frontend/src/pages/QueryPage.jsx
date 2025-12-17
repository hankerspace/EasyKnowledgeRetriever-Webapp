import React, { useState, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Send, User, Bot, Sparkles } from 'lucide-react';

const QueryPage = () => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  
  const { register, handleSubmit, reset } = useForm();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const onSubmit = async (data) => {
    if (!data.query.trim()) return;
    
    const userMessage = { role: 'user', content: data.query };
    setMessages(prev => [...prev, userMessage]);
    setLoading(true);
    reset({ ...data, query: '' }); // keep mode, clear query

    try {
      // We use standard query, not stream for now to keep it robust
      const response = await api.post('/query', {
        query: userMessage.content
      });
      
      const answerObj = response.data.answer;
      // Handle both object (QueryResult) and string (legacy/fallback) formats
      let content = answerObj && typeof answerObj === 'object' ? answerObj.content : answerObj;

      // Fix for literal newlines and escaped sequences
      if (typeof content === 'string') {
        content = content.replace(/\\n/g, '\n').replace(/\\r/g, '');
      }

      const botMessage = { 
        role: 'assistant', 
        content: content || "Pas de réponse.",
        context: response.data.contexts || (answerObj && answerObj.chunks) || (answerObj && answerObj.context)
      };
      
      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      toast.error("Erreur lors de la requête");
      setMessages(prev => [...prev, { role: 'assistant', content: "Désolé, une erreur est survenue." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] max-w-5xl mx-auto space-y-4">
      <div className="flex justify-between items-center">
        <div>
           <h2 className="text-3xl font-bold tracking-tight">Recherche</h2>
           <p className="text-muted-foreground">Interrogez votre base de connaissances.</p>
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50/50" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <Sparkles className="w-12 h-12 mb-4 opacity-50" />
              <p>Posez une question pour commencer...</p>
            </div>
          )}
          
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-blue-600 text-white'}`}>
                {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
              </div>
              
              <div className={`max-w-[80%] space-y-2`}>
                <div className={`p-4 rounded-lg text-sm ${msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 shadow-sm overflow-x-auto'}`}>
                  {msg.role === 'assistant' ? (
                    <ReactMarkdown 
                      className="prose prose-sm max-w-none prose-slate whitespace-pre-wrap" 
                      remarkPlugins={[remarkGfm]}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    msg.content
                  )}
                </div>
                
                {msg.context && (
                  <div className="text-xs text-slate-500 bg-slate-100 p-2 rounded border border-slate-200">
                    <span className="font-semibold">Sources:</span>
                    <ul className="list-disc pl-4 mt-1 space-y-1">
                      {/* Simple rendering of context snippets or docs */}
                      {Array.isArray(msg.context) ? msg.context.slice(0, 3).map((ctx, i) => (
                         <li key={i} className="line-clamp-1">{typeof ctx === 'string' ? ctx : JSON.stringify(ctx).slice(0, 100)}</li>
                      )) : <li>{JSON.stringify(msg.context).slice(0, 100)}...</li>}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
          
          {loading && (
             <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5" />
              </div>
              <div className="bg-white border border-slate-200 shadow-sm p-4 rounded-lg text-sm">
                 <span className="animate-pulse">Réflexion en cours...</span>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-white border-t border-slate-200">
          <form onSubmit={handleSubmit(onSubmit)} className="flex gap-2">
            <Input
              placeholder="Posez votre question..." 
              {...register('query', { required: true })} 
              className="flex-1"
              autoComplete="off"
            />
            <Button type="submit" disabled={loading}>
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
};

export default QueryPage;
