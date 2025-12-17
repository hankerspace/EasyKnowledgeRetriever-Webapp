import React, { useState, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Send, User, Bot, Sparkles, Info, FileText, Copy, Check } from 'lucide-react';

const CopyButton = ({ content }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Message copié !");
    } catch (err) {
      toast.error("Erreur lors de la copie");
    }
  };

  return (
    <Button 
      variant="ghost" 
      size="icon" 
      className="h-6 w-6 text-slate-400 hover:text-slate-600 absolute top-2 right-2"
      onClick={handleCopy}
      title="Copier le message"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );
};

const parseRagContent = (content) => {
  if (typeof content !== 'string') return { text: content, references: [] };

  // 1. Extract References/Sources section at the end
  // Matches:
  // - Optional newline
  // - Optional "References" or "Sources" header (with optional Markdown/punctuation)
  // - Block of lines starting with [number]
  const refSectionRegex = /(?:(?:\n+(?:#+\s*|\*\*|__)?(?:References?|Sources?)(?:\*\*|__)?\s*:?)?\s+)?((?:\[\d+\].+(?:\n\s*|$))+)$/i;
  const match = content.match(refSectionRegex);
  
  let text = content;
  let references = [];

  if (match) {
    // Check if the match looks like a real references section (at least one [n] source)
    const refBlock = match[1];
    const hasRefs = /\[\d+\]/.test(refBlock);
    
    if (hasRefs) {
      text = content.substring(0, match.index).trim();
      
      const refLines = refBlock.trim().split('\n');
      refLines.forEach(line => {
        const lineMatch = line.match(/^\[(\d+)\]\s+(.+)$/);
        if (lineMatch) {
          references.push({
            id: lineMatch[1],
            source: lineMatch[2].trim()
          });
        }
      });
    }
  }

  // 2. Process inline citations to create badges
  // Replace [1] or [1, page X] with a markdown link that will be rendered as a badge
  const citationRegex = /\[(\d+)(?:,\s*page\s*(\d+))?\]/g;
  
  text = text.replace(citationRegex, (match, id, page) => {
    const params = new URLSearchParams();
    params.append('id', id);
    if (page) params.append(`page_${id}`, page);
    
    // We use a special link format. The text inside [] will be displayed in the badge.
    return ` [[${id}]](${'#citation?' + params.toString()}) `;
  });

  return { text, references };
};

const CitationTooltip = ({ data }) => {
  if (!data) return null;
  const { ids, pages, rect, references } = data;

  const style = {
    position: 'fixed',
    top: rect.bottom + 8,
    left: Math.min(rect.left, window.innerWidth - 320), // Prevent overflow right
    maxWidth: '300px',
    zIndex: 50,
    pointerEvents: 'none'
  };

  return (
    <div style={style} className="bg-slate-800 text-white text-xs rounded-md shadow-xl p-3 z-50 animate-in fade-in zoom-in-95 duration-200 border border-slate-700">
       <div className="font-semibold mb-1.5 text-slate-300 border-b border-slate-700 pb-1">Sources</div>
       <ul className="space-y-1.5">
          {ids.map(id => {
             const ref = references.find(r => r.id === id);
             const page = pages[`page_${id}`];
             return (
               <li key={id} className="flex items-start gap-2">
                  <span className="font-bold text-blue-400 shrink-0 mt-0.5">[{id}]</span>
                  <span className="leading-tight">
                    {ref ? ref.source : "Source inconnue"}
                    {page && <span className="ml-1 text-slate-400">(Page {page})</span>}
                  </span>
               </li>
             );
          })}
       </ul>
    </div>
  );
};

const DetailsViewer = ({ details }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  if (!details) return null;
  
  return (
    <div className="mt-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 h-auto py-1 px-2"
      >
        <Info className="w-3 h-3" />
        {isOpen ? "Masquer les détails" : "Afficher les détails techniques"}
      </Button>
      
      {isOpen && (
        <div className="mt-2 space-y-3 bg-slate-50 p-3 rounded-md border border-slate-200 text-xs font-mono overflow-auto max-h-96">
          {details.system_prompt && (
             <div>
                <div className="font-bold text-slate-700 mb-1">System Prompt</div>
                <div className="bg-white p-2 rounded border border-slate-200 whitespace-pre-wrap text-slate-600">
                  {details.system_prompt}
                </div>
             </div>
          )}
          
          {details.user_prompt && (
             <div>
                <div className="font-bold text-slate-700 mb-1">User Prompt</div>
                <div className="bg-white p-2 rounded border border-slate-200 whitespace-pre-wrap text-slate-600">
                  {details.user_prompt}
                </div>
             </div>
          )}
          
          {details.metadata && Object.keys(details.metadata).length > 0 && (
             <div>
                <div className="font-bold text-slate-700 mb-1">Metadata</div>
                <div className="bg-white p-2 rounded border border-slate-200 whitespace-pre-wrap text-slate-600">
                  {JSON.stringify(details.metadata, null, 2)}
                </div>
             </div>
          )}
        </div>
      )}
    </div>
  );
};

const QueryPage = () => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeCitation, setActiveCitation] = useState(null);
  const scrollRef = useRef(null);
  
  const { register, handleSubmit, reset } = useForm();
// ... (rest of component logic)

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
    reset({ ...data, query: '' });

    try {
      const response = await api.post('/query', {
        query: userMessage.content
      });
      
      const answerObj = response.data.answer;
      let content = answerObj && typeof answerObj === 'object' ? answerObj.content : answerObj;

      if (typeof content === 'string') {
        content = content.replace(/\\n/g, '\n').replace(/\\r/g, '');
      }

      const botMessage = { 
        role: 'assistant', 
        content: content || "Pas de réponse.",
        context: response.data.contexts || (answerObj && answerObj.chunks) || (answerObj && answerObj.context),
        details: answerObj ? {
            system_prompt: answerObj.system_prompt,
            user_prompt: answerObj.user_prompt,
            metadata: answerObj.metadata
        } : null
      };
      
      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      toast.error("Erreur lors de la requête");
      setMessages(prev => [...prev, { role: 'assistant', content: "Désolé, une erreur est survenue." }]);
    } finally {
      setLoading(false);
    }
  };

  const getMarkdownComponents = (references) => ({
    a: ({ node, ...props }) => {
      if (props.href && props.href.startsWith('#citation?')) {
        const params = new URLSearchParams(props.href.replace('#citation?', ''));
        const ids = params.getAll('id');
        const pages = {};
        ids.forEach(id => {
            const p = params.get(`page_${id}`);
            if (p) pages[`page_${id}`] = p;
        });
        
        return (
          <span 
            className="inline-flex items-center justify-center bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full cursor-default hover:bg-blue-200 transition-colors mx-0.5 align-super transform -translate-y-0.5 border border-blue-200"
            onMouseEnter={(e) => {
              setActiveCitation({
                ids,
                pages,
                rect: e.currentTarget.getBoundingClientRect(),
                references
              });
            }}
            onMouseLeave={() => setActiveCitation(null)}
          >
            {props.children}
          </span>
        );
      }
      return <a {...props} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer" />;
    }
  });

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] max-w-5xl mx-auto space-y-4 relative">
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
          
          {messages.map((msg, idx) => {
            const isAssistant = msg.role === 'assistant';
            const { text, references } = isAssistant ? parseRagContent(msg.content) : { text: msg.content, references: [] };
            const hasSources = (msg.context && Array.isArray(msg.context) && msg.context.length > 0) || references.length > 0;

            return (
              <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-blue-600 text-white'}`}>
                  {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                </div>
                
                <div className={`max-w-[80%] space-y-2`}>
                  <div className={`p-4 rounded-lg text-sm ${msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 shadow-sm overflow-x-auto relative pr-10'}`}>
                    {isAssistant && <CopyButton content={msg.content} />}
                    {isAssistant ? (
                      <ReactMarkdown 
                        className="prose prose-sm max-w-none prose-slate whitespace-pre-wrap leading-relaxed" 
                        remarkPlugins={[remarkGfm]}
                        components={getMarkdownComponents(references)}
                      >
                        {text}
                      </ReactMarkdown>
                    ) : (
                      msg.content
                    )}
                  </div>
                  
                  {hasSources && (
                    <div className="text-xs text-slate-500 bg-slate-100 p-3 rounded border border-slate-200 mt-2">
                      <div className="flex items-center gap-2 font-semibold mb-2 text-slate-700">
                        <FileText className="w-3 h-3" />
                        <span>Sources</span>
                      </div>
                      <ul className="list-none space-y-2 pl-1">
                        {/* Display extracted references */}
                        {references.map((ref, i) => (
                          <li key={`ref-${i}`} className="flex gap-2 text-slate-600 break-all">
                             <span className="shrink-0 font-medium text-blue-600 bg-blue-50 px-1.5 rounded text-[10px] border border-blue-100 h-fit self-start">
                               {ref.id}
                             </span>
                             <span>{ref.source}</span>
                          </li>
                        ))}

                        {/* Display additional context if any */}
                        {Array.isArray(msg.context) && msg.context.map((ctx, i) => {
                           const ctxStr = typeof ctx === 'string' ? ctx : ctx.source;
                           const isDuplicate = references.some(r => r.source === ctxStr);
                           if (isDuplicate) return null;

                           return (
                             <li key={`ctx-${i}`} className="flex gap-2 text-slate-600">
                               <span className="shrink-0 w-1 h-1 rounded-full bg-slate-400 mt-1.5 ml-1" />
                               <span className="line-clamp-2">
                                 {typeof ctx === 'string' ? ctx : (ctx.source ? `${ctx.source} ${ctx.page ? `(Page ${ctx.page})` : ''}` : JSON.stringify(ctx).slice(0, 100))}
                               </span>
                             </li>
                           );
                        })}
                      </ul>
                    </div>
                  )}
                  
                  {isAssistant && msg.details && <DetailsViewer details={msg.details} />}
                </div>
              </div>
            );
          })}
          
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

      <CitationTooltip data={activeCitation} />
    </div>
  );
};

export default QueryPage;