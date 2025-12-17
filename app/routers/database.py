"""Database access API router"""
import json
from fastapi import APIRouter, HTTPException
from app.models.database import (
    GraphNode, GraphEdge, GraphSearchRequest, GraphSearchResponse,
    GraphExportRequest, GraphExportResponse, VectorSearchRequest, VectorSearchResponse,
    KVListResponse, KVValueResponse
)
from app.state import rag_state

router = APIRouter(prefix="/db", tags=["Database Access"])


def _check_initialized():
    """Check if RAG is initialized"""
    if not rag_state.is_initialized:
        raise HTTPException(
            status_code=400, 
            detail="RAG is not initialized. Please call POST /rag/initialize first"
        )


async def _get_nx_graph(graph_storage):
    """Helper to safely get NetworkX graph from storage"""
    graph = None
    
    # 1. Try to get graph via _get_graph (async, might use lock)
    if hasattr(graph_storage, '_get_graph'):
        try:
            graph = await graph_storage._get_graph()
        except Exception:
            # Fallback if _get_graph fails (e.g. lock issue)
            pass
    
    # 2. Try direct access
    if graph is None and hasattr(graph_storage, '_graph'):
        graph = graph_storage._graph
        
    # 3. Fallback: manually load if graph is still None and loading method exists
    if graph is None and hasattr(graph_storage, 'load_nx_graph'):
        import os
        working_dir = getattr(graph_storage, 'working_dir', None)
        
        # If working_dir is missing or empty, try getting from rag_state config
        if not working_dir and rag_state.is_initialized:
             config = rag_state.get_current_config()
             working_dir = config.get('working_dir')
        
        if working_dir:
            # Assume default filename used by NetworkXStorage
            graph_file = os.path.join(working_dir, "graph_chunk_entity_relation.graphml")
            if os.path.exists(graph_file):
                try:
                    graph = graph_storage.load_nx_graph(graph_file)
                    # Cache it if possible to avoid reloading every time
                    if hasattr(graph_storage, '_graph'):
                        try:
                            graph_storage._graph = graph
                        except:
                            pass
                except Exception:
                    pass
                    
    return graph


# ============ Graph Endpoints ============

@router.get("/graph/nodes", response_model=GraphSearchResponse)
async def get_graph_nodes(limit: int = 100000, offset: int = 0):
    """List all graph nodes (entities)"""
    _check_initialized()
    
    try:
        graph_storage = rag_state._graph_storage
        
        # Try to get nodes from the graph
        nodes = []
        if hasattr(graph_storage, '_graph'):
            # NetworkX storage
            import networkx as nx
            
            graph = await _get_nx_graph(graph_storage)
                
            if graph is not None:
                node_list = list(graph.nodes(data=True))
                
                for node_id, data in node_list[offset:offset + limit]:
                    nodes.append(GraphNode(
                        id=str(node_id),
                        label=data.get("entity_type", data.get("label", "Unknown")),
                        properties=dict(data)
                    ))
        
        return GraphSearchResponse(
            nodes=nodes,
            edges=[],
            total_nodes=len(nodes),
            total_edges=0
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get nodes: {str(e)}")


@router.get("/graph/edges", response_model=GraphSearchResponse)
async def get_graph_edges(limit: int = 100000, offset: int = 0):
    """List all graph edges (relationships)"""
    _check_initialized()
    
    try:
        graph_storage = rag_state._graph_storage
        
        edges = []
        if hasattr(graph_storage, '_graph'):
            import networkx as nx
            
            graph = await _get_nx_graph(graph_storage)
            
            if graph is not None:
                edge_list = list(graph.edges(data=True))
                
                for source, target, data in edge_list[offset:offset + limit]:
                    edges.append(GraphEdge(
                        source=str(source),
                        target=str(target),
                        label=data.get("relation", data.get("label", "RELATED_TO")),
                        properties=dict(data)
                    ))
        
        return GraphSearchResponse(
            nodes=[],
            edges=edges,
            total_nodes=0,
            total_edges=len(edges)
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get edges: {str(e)}")


@router.post("/graph/search", response_model=GraphSearchResponse)
async def search_graph(request: GraphSearchRequest):
    """Search entities and relationships in the graph"""
    _check_initialized()
    
    try:
        graph_storage = rag_state._graph_storage
        query_lower = request.query.lower()
        
        nodes = []
        edges = []
        
        if hasattr(graph_storage, '_graph'):
            graph = await _get_nx_graph(graph_storage)
            
            if graph is not None:
                # Search nodes
                if request.search_type in ["nodes", "both"]:
                    for node_id, data in graph.nodes(data=True):
                        node_str = str(node_id).lower()
                        if query_lower in node_str or any(query_lower in str(v).lower() for v in data.values()):
                            nodes.append(GraphNode(
                                id=str(node_id),
                                label=data.get("entity_type", data.get("label", "Unknown")),
                                properties=dict(data)
                            ))
                            if len(nodes) >= request.limit:
                                break
                
                # Search edges
                if request.search_type in ["edges", "both"]:
                    for source, target, data in graph.edges(data=True):
                        edge_str = f"{source} {target} {data.get('relation', '')}".lower()
                        if query_lower in edge_str:
                            edges.append(GraphEdge(
                                source=str(source),
                                target=str(target),
                                label=data.get("relation", data.get("label", "RELATED_TO")),
                                properties=dict(data)
                            ))
                            if len(edges) >= request.limit:
                                break
        
        return GraphSearchResponse(
            nodes=nodes,
            edges=edges,
            total_nodes=len(nodes),
            total_edges=len(edges)
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph search failed: {str(e)}")


@router.post("/graph/export", response_model=GraphExportResponse)
async def export_graph(request: GraphExportRequest):
    """Export the full graph in specified format"""
    _check_initialized()
    
    try:
        graph_storage = rag_state._graph_storage
        
        if not hasattr(graph_storage, '_graph'):
            raise HTTPException(status_code=400, detail="Graph export not supported for this storage type")
        
        graph = None
        if hasattr(graph_storage, '_get_graph'):
            graph = await graph_storage._get_graph()
        
        if graph is None:
            graph = graph_storage._graph
            
        if graph is None:
            import networkx as nx
            graph = nx.Graph()
        
        node_count = graph.number_of_nodes()
        edge_count = graph.number_of_edges()
        
        if request.format == "json":
            import networkx as nx
            data = nx.node_link_data(graph)
            export_data = json.dumps(data, indent=2, default=str)
        elif request.format == "graphml":
            import networkx as nx
            from io import BytesIO
            buffer = BytesIO()
            nx.write_graphml(graph, buffer)
            export_data = buffer.getvalue().decode('utf-8')
        elif request.format == "cypher":
            # Generate Cypher statements for Neo4j import
            cypher_statements = []
            for node_id, data in graph.nodes(data=True):
                props = ", ".join([f'{k}: "{v}"' for k, v in data.items()])
                label = data.get("entity_type", "Entity")
                cypher_statements.append(f'CREATE (n:{label} {{id: "{node_id}", {props}}})')
            for source, target, data in graph.edges(data=True):
                rel_type = data.get("relation", "RELATED_TO").upper().replace(" ", "_")
                cypher_statements.append(f'MATCH (a {{id: "{source}"}}), (b {{id: "{target}"}}) CREATE (a)-[:{rel_type}]->(b)')
            export_data = ";\n".join(cypher_statements)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown export format: {request.format}")
        
        return GraphExportResponse(
            success=True,
            format=request.format,
            data=export_data,
            node_count=node_count,
            edge_count=edge_count
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph export failed: {str(e)}")


# ============ Vector Endpoints ============

@router.post("/vectors/search", response_model=VectorSearchResponse)
async def search_vectors(request: VectorSearchRequest):
    """Search the vector store"""
    _check_initialized()
    
    try:
        # Use the embedding service to encode the query
        query_embedding = await rag_state._embedding_service.embed([request.query])
        
        # Search in vector storage
        vector_storage = rag_state._vector_storage
        if hasattr(vector_storage, 'query'):
            results = await vector_storage.query(query_embedding[0], top_k=request.top_k)
        else:
            results = []
        
        # Format results
        formatted_results = []
        for result in results:
            if isinstance(result, dict):
                formatted_results.append(result)
            elif isinstance(result, tuple) and len(result) >= 2:
                formatted_results.append({
                    "id": result[0],
                    "score": result[1],
                    "content": result[2] if len(result) > 2 else None
                })
        
        return VectorSearchResponse(
            results=formatted_results,
            total=len(formatted_results)
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vector search failed: {str(e)}")


# ============ KV Storage Endpoints ============

@router.get("/kv/keys", response_model=KVListResponse)
async def list_kv_keys(prefix: str = "", limit: int = 100000):
    """List keys in KV storage"""
    _check_initialized()
    
    try:
        kv_storage = rag_state._kv_storage
        
        # Try to get keys
        if hasattr(kv_storage, 'keys'):
            all_keys = await kv_storage.keys()
        elif hasattr(kv_storage, '_data'):
            all_keys = list(kv_storage._data.keys())
        else:
            all_keys = []
        
        # Filter by prefix
        if prefix:
            all_keys = [k for k in all_keys if k.startswith(prefix)]
        
        return KVListResponse(
            keys=all_keys[:limit],
            total=len(all_keys)
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list keys: {str(e)}")


@router.get("/kv/{key:path}", response_model=KVValueResponse)
async def get_kv_value(key: str):
    """Get a value from KV storage"""
    _check_initialized()
    
    try:
        kv_storage = rag_state._kv_storage
        
        value = await kv_storage.get(key)
        
        return KVValueResponse(
            key=key,
            value=json.dumps(value, default=str) if value is not None else None,
            exists=value is not None
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get value: {str(e)}")


