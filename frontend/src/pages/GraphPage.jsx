import React, { useEffect, useState, useRef, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import api from '../lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { RefreshCw, ZoomIn, ZoomOut, X } from 'lucide-react';
import { toast } from 'sonner';

const GraphPage = () => {
  const [data, setData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [dimensions, setDimensions] = useState({ w: 800, h: 600 });
  const [selectedElement, setSelectedElement] = useState(null);
  const containerRef = useRef(null);
  const fgRef = useRef();

  const fetchData = async () => {
    setLoading(true);
    try {
      // Removed limit query parameters as requested
      const [nodesRes, edgesRes] = await Promise.all([
        api.get('/db/graph/nodes'),
        api.get('/db/graph/edges')
      ]);

      let rawNodes = nodesRes.data.nodes || [];
      const rawLinks = edgesRes.data.edges || [];

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
      toast.success(`Graphe chargé: ${nodes.length} nœuds, ${links.length} liens`);
    } catch (error) {
      console.error(error);
      toast.error("Erreur lors du chargement du graphe");
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
            <span className="font-semibold text-slate-500 capitalize">{item.key}:</span>
            <span className="break-words text-sm whitespace-pre-wrap">
                {typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value)}
            </span>
          </div>
      ));
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] space-y-4 relative">
       <div className="flex justify-between items-center">
        <div>
           <h2 className="text-3xl font-bold tracking-tight">Visualisation</h2>
           <p className="text-muted-foreground">Exploration du graphe de connaissances.</p>
        </div>
        <div className="flex gap-2">
           <Button variant="outline" size="icon" onClick={handleZoomOut}><ZoomOut className="w-4 h-4" /></Button>
           <Button variant="outline" size="icon" onClick={handleZoomIn}><ZoomIn className="w-4 h-4" /></Button>
           <Button onClick={fetchData} disabled={loading}>
             <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
             Rafraîchir
           </Button>
        </div>
      </div>

      <div className="flex flex-1 gap-4 min-h-0">
        <div className="flex-1 relative overflow-hidden rounded-xl border border-slate-200 bg-white" ref={containerRef}>
          {data.nodes.length > 0 ? (
             <ForceGraph2D
              ref={fgRef}
              width={dimensions.w}
              height={dimensions.h}
              graphData={data}
              nodeLabel="id"
              nodeColor={() => '#475569'}
              linkColor={() => '#cbd5e1'}
              backgroundColor="#ffffff"
              nodeRelSize={6}
              linkDirectionalArrowLength={3.5}
              linkDirectionalArrowRelPos={1}
              linkWidth={link => Math.sqrt(link.weight || 1)}
              onNodeClick={handleNodeClick}
              onLinkClick={handleLinkClick}
              nodeCanvasObjectMode={() => 'after'}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const label = node.id;
                const fontSize = 12/globalScale;
                ctx.font = `${fontSize}px Sans-Serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = '#000';
                ctx.fillText(label, node.x, node.y + 8);
              }}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400">
              {loading ? 'Chargement...' : 'Aucune donnée de graphe disponible.'}
            </div>
          )}
        </div>

        {/* Property Window Sidebar */}
        {selectedElement && (
          <Card className="w-80 shadow-sm bg-white flex flex-col border-slate-200 h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b p-4">
              <CardTitle className="text-base font-medium">
                {selectedElement.type === 'node' ? 'Détails du Nœud' : 'Détails de la Relation'}
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={closePropertyWindow} className="h-6 w-6">
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-4">
              <div className="grid gap-1">
                {renderProperties(selectedElement.data)}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default GraphPage;
