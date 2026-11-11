import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDocuments, uploadDocument, deleteDocument } from "../api";

export default function DocumentsView() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [filename, setFilename] = useState("");
  const [category, setCategory] = useState("General");
  const [content, setContent] = useState("");

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: getDocuments,
  });

  const uploadMutation = useMutation({
    mutationFn: () => uploadDocument(filename, content, category),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      setShowUpload(false);
      setFilename("");
      setContent("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
    },
  });

  const filtered = docs.filter(d =>
    d.filename.toLowerCase().includes(search.toLowerCase()) ||
    d.category.toLowerCase().includes(search.toLowerCase()) ||
    d.preview.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="view-container">
      {/* Header */}
      <div className="view-header">
        <div>
          <h2 className="view-title">Document Intelligence Center</h2>
          <p className="view-subtitle">Knowledge ingestion, semantic chunking & RAG vector indexing</p>
        </div>
        <button className="primary-btn" onClick={() => setShowUpload(prev => !prev)} type="button">
          {showUpload ? "✕ Close" : "+ Ingest Document"}
        </button>
      </div>

      {/* Upload Form (Expandable) */}
      {showUpload && (
        <div className="upload-box">
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Ingest Knowledge Document</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
            <div>
              <label className="input-label">Document Filename (.md, .txt, .pdf, .docx)</label>
              <input
                className="form-input"
                value={filename}
                onChange={e => setFilename(e.target.value)}
                placeholder="e.g. SRE-OnCall-Playbook.md"
              />
            </div>
            <div>
              <label className="input-label">Department / Category</label>
              <select className="form-input" value={category} onChange={e => setCategory(e.target.value)}>
                <option value="IT Support">IT Support</option>
                <option value="DevOps">DevOps</option>
                <option value="HR">HR</option>
                <option value="Finance">Finance</option>
                <option value="General">General</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="input-label">Document Text Content</label>
            <textarea
              className="form-input"
              rows={4}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Paste or write document policies, procedures, or instructions here..."
            />
          </div>
          <button
            className="primary-btn"
            disabled={!filename.trim() || uploadMutation.isPending}
            onClick={() => uploadMutation.mutate()}
            type="button"
          >
            {uploadMutation.isPending ? "Indexing..." : "Index Document into pgvector"}
          </button>
        </div>
      )}

      {/* Search Input */}
      <div style={{ marginBottom: 16 }}>
        <input
          className="form-input"
          placeholder="🔍 Search indexed documents, policies, or runbooks..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Documents List */}
      {isLoading ? (
        <div style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>Loading knowledge base...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">No matching documents found.</div>
      ) : (
        <div className="doc-list">
          {filtered.map(doc => (
            <div key={doc.id} className="doc-card">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span className="file-badge">{doc.file_type.toUpperCase()}</span>
                    <span className="doc-name">{doc.filename}</span>
                    <span className="category-pill">{doc.category}</span>
                  </div>
                  <p className="doc-preview">{doc.preview}</p>
                </div>
                <button
                  className="icon-del-btn"
                  title="Remove document from index"
                  onClick={() => deleteMutation.mutate(doc.id)}
                  type="button"
                >
                  ✕
                </button>
              </div>

              <div className="doc-meta-footer">
                <span>⚡ {doc.chunks_count} semantic chunks</span>
                <span>📦 {(doc.size_bytes / 1024).toFixed(1)} KB</span>
                <span>📅 {doc.uploaded_at}</span>
                <span className="text-emerald font-semibold">● Vector Indexed</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
