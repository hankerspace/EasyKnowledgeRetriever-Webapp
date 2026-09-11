import React, { useEffect, useState, useRef, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useTheme } from 'next-themes';
import api from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RefreshCw, ZoomIn, ZoomOut, X, Waypoints } from 'lucide-react';
import { toast } from 'sonner';

// Canvas colours cannot read CSS variables, so mirror the theme here.
const PALETTE = {
  light: { node: '#4f46e5', link: '#d4d4d8', bg: '#ffffff', text: '#18181b' },
  dark: { node: '#a5b4fc', link: '#3f3f46', bg: '#12141c', text: '#e4e4e7' },
};

// Rendering caps. react-force-graph-2d stops being usable well below this on
// a typical laptop; raise only if you have measured it on your corpus.
const NODE_LIMIT = 500;
const EDGE_LIMIT = 1000;

const GraphPage = () => {
  const { t } = useI18n();
  const [data, setData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(null);
  const [dimensions, setDimensions] = useState({ w: 800, h: 600 });
  const [selectedElement, setSelectedElement] = useState(null);
  const containerRef = useRef(null);
  const fgRef = useRef();
  const { resolvedTheme } = useTheme();
  const colors = PALETTE[resolvedTheme === 'dark' ? 'dark' : 'light'];

  const fetchData = async () => {
    setLoading(true);
    try {
      // The graph is capped on purpose: a full corpus yields thousands of
      // entities, which means a multi-MB payload and a force simulation that
      // freezes the tab. The API reports the real totals so we can say when
      // the view is partial.
      const [nodesRes, edgesRes] = await Promise.all([
        api.get('/db/graph/nodes', { params: { limit: NODE_LIMIT } }),
        api.get('/db/graph/edges', { params: { limit: EDGE_LIMIT } })
      ]);

      let rawNodes = nodesRes.data.nodes || [];
      const rawLinks = edgesRes.data.edges || [];

      const totalNodes = nodesRes.data.total_nodes ?? rawNodes.length;
      const totalEdges = edgesRes.data.total_edges ?? rawLinks.length;

      // Process links
      const links = rawLinks.map(e => ({
        source: e.source || e[0],
        target: e.target || e[1],
        label: e.label || e[2], // Assuming tuple might have label
        ...((typeof e === 'object' && !Array.isArray(e)) ? e : {})
      }));

      // Collect all unique node IDs from nodes and edges to ensure we display everything
      const nodeMap = new Map();

      // Add existing nodes from API
      rawNodes.forEach(n => {
        const id = n.id || n;
        const obj = (typeof n === 'object') ? n : { id };
        nodeMap.set(id, { ...obj, id });
      });

      // Add nodes found in edges but missing in nodes list (implicit nodes)
      links.forEach(l => {
        const sourceId = (typeof l.source === 'object') ? l.source.id : l.source;
        const targetId = (typeof l.target === 'object') ? l.target.id : l.target;

        if (sourceId && !nodeMap.has(sourceId)) nodeMap.set(sourceId, { id: sourceId });
        if (targetId && !nodeMap.has(targetId)) nodeMap.set(targetId, { id: targetId });
      });

      const nodes = Array.from(nodeMap.values());

      setData({ nodes, links });

      const isPartial = totalNodes > rawNodes.length || totalEdges > rawLinks.length;
      setTruncated(isPartial ? { totalNodes, totalEdges } : null);

      if (isPartial) {
        toast.warning(t('graph.partialToast', { nodes: nodes.length, totalNodes, links: links.length, totalEdges }));
      } else {
        toast.success(t('graph.loaded', { nodes: nodes.length, links: links.length }));
      }
    } catch (error) {
      console.error(error);
      toast.error(t('graph.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({
          w: entry.contentRect.width,
          h: entry.contentRect.height
        });
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const handleZoomIn = () => {
    if (fgRef.current) fgRef.current.zoom(fgRef.current.zoom() * 1.2, 400);
  };

  const handleZoomOut = () => {
    if (fgRef.current) fgRef.current.zoom(fgRef.current.zoom() / 1.2, 400);
  };

  const handleNodeClick = useCallback(node => {
    setSelectedElement({ type: 'node', data: node });
    // Center view on node
    if (fgRef.current) {
        fgRef.current.centerAt(node.x, node.y, 1000);
        fgRef.current.zoom(4, 2000);
    }
  }, [fgRef]);

  const handleLinkClick = useCallback(link => {
    setSelectedElement({ type: 'link', data: link });
  }, []);

  const closePropertyWindow = () => {
    setSelectedElement(null);
  };

  const renderProperties = (data) => {
      const items = [];
      const ignoredKeys = ['x', 'y', 'vx', 'vy', 'index', 'color', '__indexColor', 'source', 'target', '__controlPoints', '__arrowLength', '__lineLength', 'id'];

      // Explicitly add ID/Source/Target at the top
      if (data.id) items.push({ key: 'ID', value: data.id });

      // Handle Source/Target for links
      if (data.source) {
          const val = typeof data.source === 'object' ? data.source.id : data.source;
          items.push({ key: 'Source', value: val });
      }
      if (data.target) {
          const val = typeof data.target === 'object' ? data.target.id : data.target;
          items.push({ key: 'Target', value: val });
      }

      // Add label/weight if present
      if (data.label) items.push({ key: 'Label', value: data.label });
      if (data.weight) items.push({ key: 'Weight', value: data.weight });

      // Process other properties
      Object.entries(data).forEach(([key, value]) => {
        if (ignoredKeys.includes(key) || key === 'label' || key === 'weight') return;

        if (key === 'properties' && typeof value === 'object' && value !== null) {
           // Expand nested properties object
           Object.entries(value).forEach(([pKey, pValue]) => {
             items.push({ key: pKey, value: pValue });
           });
        } else {
           items.push({ key, value });
        }
      });

      return items.map((item, idx) => (
          <div key={idx} className="flex flex-col mb-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.key}:</span>
            <span className="break-words text-sm whitespace-pre-wrap">
                {typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value)}
            </span>
          </div>
      ));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
       <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
           <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><Waypoints className="size-5 text-muted-foreground" /> {t('graph.title')}</h2>
           <p className="text-sm text-muted-foreground">{t('graph.hint')}</p>
        </div>
        <div className="flex gap-2">
           <Button variant="outline" size="icon" onClick={handleZoomOut} aria-label={t('graph.zoomOut')}><ZoomOut className="w-4 h-4" /></Button>
           <Button variant="outline" size="icon" onClick={handleZoomIn} aria-label={t('graph.zoomIn')}><ZoomIn className="w-4 h-4" /></Button>
           <Button onClick={fetchData} disabled={loading}>
             <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
             {t('common.refresh')}
           </Button>
        </div>
      </div>

      <div className="flex flex-1 gap-4 min-h-0">
        <div className="relative flex-1 overflow-hidden rounded-xl border bg-card" ref={containerRef}>
          {truncated && (
            <div className="absolute left-2 top-2 z-10 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-foreground shadow-sm">
              {t('graph.partialBanner', { nodes: data.nodes.length, totalNodes: truncated.totalNodes, links: data.links.length, totalEdges: truncated.totalEdges })}
            </div>
          )}
          {data.nodes.length > 0 ? (
             <ForceGraph2D
              ref={fgRef}
              width={dimensions.w}
              height={dimensions.h}
              graphData={data}
              nodeLabel="id"
              nodeColor={() => colors.node}
              linkColor={() => colors.link}
              backgroundColor={colors.bg}
              nodeRelSize={6}
              linkDirectionalArrowLength={3.5}
              linkDirectionalArrowRelPos={1}
              linkWidth={link => Math.sqrt(link.weight || 1)}
              onNodeClick={handleNodeClick}
              onLinkClick={handleLinkClick}
              nodeCanvasObjectMode={() => 'after'}
              nodeCanvasObject={(node, ctx, globalScale) => {
                // Hundreds of overlapping labels are unreadable: name nodes once zoomed in (hovering shows the name anyway).
                if (globalScale < 2) return;
                const label = node.id;
                const fontSize = 12/globalScale;
                ctx.font = `${fontSize}px Sans-Serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = colors.text;
                ctx.fillText(label, node.x, node.y + 8);
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {loading ? t('common.loading') : t('graph.empty')}
            </div>
          )}
        </div>

        {/* Property Window Sidebar */}
        {selectedElement && (
          <Card className="flex h-full w-80 flex-col shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b p-4">
              <CardTitle className="text-base font-medium">
                {selectedElement.type === 'node' ? t('graph.nodeDetails') : t('graph.linkDetails')}
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={closePropertyWindow} className="h-6 w-6" aria-label={t('common.close')}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <ScrollArea className="min-h-0 flex-1">
              <CardContent className="p-4">
                <div className="grid gap-1">
                  {renderProperties(selectedElement.data)}
                </div>
              </CardContent>
            </ScrollArea>
          </Card>
        )}
      </div>
    </div>
  );
};

export default GraphPage;
