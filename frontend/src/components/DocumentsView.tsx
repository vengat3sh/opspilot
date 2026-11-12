import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteDocument, getDocuments, uploadDocument } from "../api";

export default function DocumentsView() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [filename, setFilename] = useState("");
  const [category, setCategory] = useState("General");
  const [content, setContent] = useState("");

  const { data: docs = [], isLoading, isError } = useQuery({ queryKey: ["documents"], queryFn: getDocuments });
  const uploadMutation = useMutation({
    mutationFn: () => uploadDocument(filename, content, category),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      setShowUpload(false); setFilename(""); setContent("");
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
    },
  });

  const filtered = docs.filter(d => [d.filename, d.category, d.preview].join(" ").toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Document Intelligence</h1>
          <p className="page-subtitle">Knowledge ingestion, semantic chunking, and RAG vector indexing</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowUpload(v => !v)} type="button">{showUpload ? "Close" : "+ Ingest document"}</button>
      </div>

      {showUpload && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 className="section-title">Ingest knowledge document</h3>
          <div className="grid grid-2" style={{ marginBottom: 12 }}>
            <div className="field"><label>Filename</label><input className="input" value={filename} onChange={e => setFilename(e.target.value)} placeholder="e.g. SRE-OnCall-Playbook.md" /></div>
            <div className="field"><label>Category</label>
              <select className="select" value={category} onChange={e => setCategory(e.target.value)}>
                <option value="IT Support">IT Support</option><option value="DevOps">DevOps</option><option value="HR">HR</option><option value="Finance">Finance</option><option value="General">General</option>
              </select>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 12 }}><label>Document content</label><textarea className="textarea" rows={5} value={content} onChange={e => setContent(e.target.value)} placeholder="Paste policies, procedures, runbooks, or instructions…" /></div>
          <button className="btn btn-primary" disabled={!filename.trim() || uploadMutation.isPending} onClick={() => uploadMutation.mutate()} type="button">
            {uploadMutation.isPending ? "Indexing…" : "Index document"}
          </button>
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 16, padding: 12 }}>
        <input className="input" placeholder="Search indexed documents, categories, or content previews…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search documents" />
      </div>

      {isLoading ? <div className="muted">Loading knowledge base…</div> : isError ? <div className="empty-state">Unable to load documents.</div> : filtered.length === 0 ? (
        <div className="empty-state">{docs.length === 0 ? "No documents indexed yet. Ingest a document to enable grounded answers." : "No matching documents found."}</div>
      ) : (
        <div className="grid">
          {filtered.map(doc => (
            <div key={doc.id} className="card card-pad">
              <div className="row-between" style={{ alignItems: "flex-start", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                    <span className="badge badge-info">{doc.file_type.toUpperCase()}</span>
                    <strong style={{ fontSize: 15, wordBreak: "break-word" }}>{doc.filename}</strong>
                    <span className="badge badge-neutral">{doc.category}</span>
                    {doc.indexed && <span className="badge badge-success">Indexed</span>}
                  </div>
                  <p className="muted" style={{ fontSize: 14 }}>{doc.preview}</p>
                </div>
                <button className="btn btn-danger btn-sm" title="Remove document" onClick={() => deleteMutation.mutate(doc.id)} disabled={deleteMutation.isPending} type="button">Delete</button>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12, fontSize: 12 }}>
                <span className="badge badge-neutral">⚡ {doc.chunks_count} chunks</span>
                <span className="badge badge-neutral">📦 {(doc.size_bytes / 1024).toFixed(1)} KB</span>
                <span className="badge badge-neutral">📅 {doc.uploaded_at}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}