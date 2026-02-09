# Opal Sanity Tool - Project TODO

## Project Overview
Build an Opal Tool for Optimizely Connect Platform (OCP) that integrates with Sanity CMS for content operations and RAG (Retrieval-Augmented Generation) capabilities.

## Repository
- **GitHub**: https://github.com/egandalf/opal-sanity-tool
- **Template Reference**: https://github.com/egandalf/opal_ocp_template

---

## Phase 1: Project Setup
- [x] Clone/adapt opal_ocp_template structure
- [x] Configure `app.yml` with proper app metadata
- [x] Set up `package.json` with Sanity dependencies
- [x] Configure TypeScript (`tsconfig.json`)
- [x] Create settings form for Sanity connection (`forms/settings.yml`)
  - [x] Sanity Project ID field
  - [x] Sanity Dataset field
  - [x] Sanity API Token field (read/write)
  - [x] API Version configuration
  - [x] CDN usage toggle
  - [x] Default document types
  - [x] RAG settings (max results, chunk size)

---

## Phase 2: Core Sanity CMS Operations

### Content Operations Tools
- [x] **Create Content** - Create new documents in Sanity
  - Parameters: document type, content fields, draft/published state
  - Returns: created document ID and status

- [x] **Update Content** - Update existing documents
  - Parameters: document ID, fields to update, patch operations
  - Returns: updated document confirmation

- [x] **Delete Content** - Remove documents from Sanity
  - Parameters: document ID, soft delete vs permanent
  - Returns: deletion confirmation

- [x] **Publish Content** - Publish draft documents
  - Parameters: document ID or array of IDs
  - Returns: publish status

- [x] **Unpublish Content** - Revert to draft state
  - Parameters: document ID
  - Returns: unpublish status

### Query Operations
- [x] **Get Document** - Fetch single document by ID
  - Parameters: document ID, projection fields
  - Returns: document data

- [x] **Query Documents** - GROQ query execution
  - Parameters: GROQ query string, parameters
  - Returns: query results

- [x] **List Document Types** - Get available schema types
  - Returns: array of document types with schemas

---

## Phase 3: RAG Integration

### Search & Retrieval
- [x] **Search Content** - Full-text search across Sanity content
  - Parameters: search query, filters, document types, text preview, custom fields
  - Returns: ranked search results with relevance scores

- [x] **Semantic Search** - Enhanced search folded into retrieve_context
  - Note: True vector search requires external embedding service; GROQ-based search with scoring/boosting used instead

### RAG Source Implementation
- [x] **Content Catalog** (`get_content_catalog`) - Discover available content for RAG
  - Parameters: document type (optional), include samples
  - Returns: types, counts, searchable fields, samples, date ranges

- [x] **Retrieve Context** (`retrieve_context`) - Primary RAG tool: search + fetch + chunk
  - Parameters: query, document types, max results, max chars, include metadata
  - Returns: LLM-ready text chunks with relevance scores and metadata

- [x] **Document Text** (`get_document_text`) - Extract chunked text from a specific document
  - Parameters: document ID, max chars, fields
  - Returns: chunked plain text for LLM consumption

---

## Phase 4: Advanced Features

### Asset Management
- [ ] **Upload Asset** - Upload images/files to Sanity
  - Parameters: file data, metadata, asset type
  - Returns: asset reference

- [ ] **Get Asset** - Retrieve asset information
  - Parameters: asset ID
  - Returns: asset URL and metadata

### Workflow Operations
- [ ] **Schedule Publish** - Schedule future publication
  - Parameters: document ID, publish datetime
  - Returns: schedule confirmation

- [ ] **Content History** - Get document revision history
  - Parameters: document ID
  - Returns: revision list with timestamps

### Batch Operations
- [ ] **Batch Create** - Create multiple documents
- [ ] **Batch Update** - Update multiple documents
- [ ] **Batch Publish** - Publish multiple documents

---

## Phase 5: Testing & Deployment

### Testing
- [ ] Unit tests for all tool functions
- [ ] Integration tests with Sanity API
- [ ] Mock responses for CI/CD

### Documentation
- [ ] Tool usage documentation
- [ ] Configuration guide
- [ ] Example use cases

### Deployment
- [ ] OCP app registration
- [ ] Prepare for marketplace
- [ ] Publish to OCP

---

## Technical Notes

### Sanity API Endpoints
- Content API: `https://<projectId>.api.sanity.io/v<version>/data`
- Assets API: `https://<projectId>.api.sanity.io/v<version>/assets`
- Query: `https://<projectId>.api.sanity.io/v<version>/data/query/<dataset>`
- Mutate: `https://<projectId>.api.sanity.io/v<version>/data/mutate/<dataset>`

### Dependencies to Add
```json
{
  "@sanity/client": "^6.x",
  "@sanity/image-url": "^1.x"
}
```

### GROQ Query Examples
```groq
// Get all posts
*[_type == "post"]

// Search with text
*[_type == "post" && text match $searchTerm]

// Get with references
*[_type == "post"]{..., author->}
```

---

## Status Legend
- [ ] Not started
- [x] Completed
- [~] In progress
